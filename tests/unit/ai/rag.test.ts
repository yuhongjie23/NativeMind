/**
 * RAG 三层测试（§11.3 / §13）
 *
 * 关注点：
 * - 向量层挂掉时能退化为规则层（C3 离线可用）
 * - 模型编造的候选 id 会被过滤掉
 * - 产出只是建议，不含任何写库动作（C1）
 */
import { describe, expect, it, vi } from 'vitest';
import { chunkMarkdown, chunkPlainText } from '@ai/rag/chunk-strategy';
import { RelationJudge } from '@ai/rag/relation-judge';
import { RAGOrchestrator, type CandidateProvider } from '@ai/rag/rag-orchestrator';
import { expandQuery } from '@ai/rag/query-expansion';
import { parseRewriteOutput } from '@ai/rag/query-rewriter';
import { ReRanker, parseReRankOutput } from '@ai/rag/rerank';
import {
  RetrievalStrategy,
  extractKeywords,
  defaultRetrievalOptions,
  defaultWeights,
  type RetrievalCandidate,
  type RuleCandidateSource,
} from '@ai/rag/retrieval-strategy';
import { ModelRouter } from '@ai/router/model-router';
import type {
  EmbeddingProvider,
  ModelProvider,
  RerankProvider,
  VectorMatch,
  VectorStorePort,
} from '@ai/types';

const fakeEmbedding = (options: { fail?: boolean } = {}): EmbeddingProvider => ({
  version: 'test-v1',
  embed: async (texts) => {
    if (options.fail) throw new Error('embedding 模型未安装');
    return texts.map(() => [0.1, 0.2, 0.3]);
  },
});

const fakeVectorStore = (matches: VectorMatch[]): VectorStorePort => ({
  query: async () => matches,
});

const ruleCandidates: RuleCandidateSource[] = [
  {
    chunkId: 'c1',
    noteId: 'n1',
    text: 'LoRA 通过低秩分解减少可训练参数量',
    tags: ['LLM', 'fine-tuning'],
    createdDate: '2026-07-30',
  },
  {
    chunkId: 'c2',
    noteId: 'n2',
    text: '番茄工作法建议每 25 分钟休息一次',
    tags: ['productivity'],
  },
];

describe('extractKeywords', () => {
  it('同时抽取英文词与中文二字组', () => {
    const keywords = extractKeywords('LoRA 低秩分解原理');

    expect(keywords.some((k) => k.includes('lora'))).toBe(true);
    expect(keywords.some((k) => /[\u4e00-\u9fa5]{2}/.test(k))).toBe(true);
  });

  it('去重并受 limit 限制', () => {
    const keywords = extractKeywords('lora lora lora 微调 微调', 3);

    expect(keywords.length).toBeLessThanOrEqual(3);
    expect(new Set(keywords).size).toBe(keywords.length);
  });
});

describe('expandQuery（Multi-Query / Sub-Query）', () => {
  it('复合查询拆成子问题 + 关键词聚焦变体，第一项是原查询', () => {
    const variants = expandQuery('矩阵分解和特征值，哪个更适合推荐系统');

    expect(variants[0]).toBe('矩阵分解和特征值，哪个更适合推荐系统');
    expect(variants.length).toBeGreaterThan(1);
    // 拆出的子问题应包含原句片段
    expect(variants.some((v) => v.includes('矩阵分解'))).toBe(true);
    expect(variants.some((v) => v.includes('特征值'))).toBe(true);
  });

  it('去重且受 maxVariants 限制', () => {
    const variants = expandQuery('lora 微调', { maxVariants: 2 });

    expect(variants.length).toBeLessThanOrEqual(2);
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe('parseRewriteOutput（LLM Multi-Query/HyDE 输出解析）', () => {
  it('解析查询变体与假设性答案，容忍全角/半角冒号', () => {
    const parsed = parseRewriteOutput(
      '查询1：什么是 LoRA\n查询2: LoRA 和全量微调区别\n查询3：微调原理\n假设性答案：LoRA 是一种低秩适配方法，用于高效微调大模型。'
    );

    expect(parsed.variants).toHaveLength(3);
    expect(parsed.variants[0]).toContain('LoRA');
    expect(parsed.hypothetical).toContain('低秩');
  });

  it('输出不合法时返回空变体，由上层回退启发式', () => {
    const parsed = parseRewriteOutput('模型说了一堆无关内容');

    expect(parsed.variants).toHaveLength(0);
    expect(parsed.hypothetical).toBeUndefined();
  });
});

describe('parseReRankOutput（模型重排输出解析）', () => {
  it('解析严格 JSON 数组', () => {
    const map = parseReRankOutput('[{"id":"c1","score":9},{"id":"c2","score":4}]');
    expect(map.get('c1')).toBe(9);
    expect(map.get('c2')).toBe(4);
  });

  it('容错：带 markdown 代码块或多余文字也能抽出 id/score', () => {
    const map = parseReRankOutput('```json\n[{"id":"c1","score":8}]\n```');
    expect(map.get('c1')).toBe(8);
  });
});

describe('RetrievalStrategy', () => {
  it('两层都命中时得分累加，并标记两个来源', async () => {
    const strategy = new RetrievalStrategy(
      fakeEmbedding(),
      fakeVectorStore([{ chunkId: 'c1', noteId: 'n1', text: ruleCandidates[0].text, score: 0.9 }])
    );

    const results = await strategy.retrieve(
      { text: 'LoRA 低秩分解', tags: ['LLM'] },
      ruleCandidates
    );

    expect(results[0].chunkId).toBe('c1');
    expect(results[0].matchedBy).toEqual(['rule', 'vector']);
  });

  it('大文件不挤占其它笔记：每篇笔记最多贡献 maxChunksPerNote 个 chunk', async () => {
    // 一篇大笔记有 5 个命中 chunk，另一篇只有 1 个 —— 多样性重排后小笔记不会被挤出
    const bigNoteChunks = [1, 2, 3, 4, 5].map((i) => ({
      chunkId: `big-${i}`,
      noteId: 'big',
      text: `大文件里的 LoRA 相关片段 ${i}`,
      tags: ['LLM'],
    }));
    const small = { chunkId: 'small-1', noteId: 'small', text: '小笔记的 LoRA 相关片段', tags: ['LLM'] };
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]));

    const results = await strategy.retrieve({ text: 'LoRA', tags: ['LLM'] }, [...bigNoteChunks, small], 10);

    const bigCount = results.filter((r) => r.noteId === 'big').length;
    expect(bigCount).toBeLessThanOrEqual(defaultRetrievalOptions.maxChunksPerNote);
    expect(results.some((r) => r.noteId === 'small')).toBe(true);
  });

  it('向量层失败时退化为规则层，不抛错（C3）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = new RetrievalStrategy(fakeEmbedding({ fail: true }), fakeVectorStore([]));

    const results = await strategy.retrieve({ text: 'LoRA', tags: ['LLM'] }, ruleCandidates);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchedBy).toEqual(['rule']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('excludeNoteIds 生效，新笔记不会和自己建链接', async () => {
    const strategy = new RetrievalStrategy(
      fakeEmbedding(),
      fakeVectorStore([{ chunkId: 'c1', noteId: 'n1', text: 'x', score: 0.95 }])
    );

    const results = await strategy.retrieve(
      { text: 'LoRA', tags: ['LLM'], excludeNoteIds: ['n1'] },
      ruleCandidates
    );

    expect(results.every((r) => r.noteId !== 'n1')).toBe(true);
  });

  it('低于 minScore 的候选被丢弃，减少模型层无效判断', async () => {
    const strategy = new RetrievalStrategy(
      fakeEmbedding(),
      fakeVectorStore([{ chunkId: 'c9', noteId: 'n9', text: '毫不相关', score: 0.05 }])
    );

    const results = await strategy.retrieve({ text: '完全不沾边的查询' }, []);

    expect(results).toEqual([]);
  });

  it('结果按综合分降序返回并受 limit 限制', async () => {
    const strategy = new RetrievalStrategy(
      fakeEmbedding(),
      fakeVectorStore([
        { chunkId: 'v1', noteId: 'n3', text: 'a', score: 0.9 },
        { chunkId: 'v2', noteId: 'n4', text: 'b', score: 0.7 },
        { chunkId: 'v3', noteId: 'n5', text: 'c', score: 0.5 },
      ])
    );

    const results = await strategy.retrieve({ text: 'LoRA' }, [], 2);

    expect(results).toHaveLength(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('多篇笔记命中时按笔记轮询，各篇段落都出现在结果里', async () => {
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]));
    const results = await strategy.retrieve(
      { text: 'LoRA', tags: ['LLM'] },
      [
        { chunkId: 'a1', noteId: 'nA', text: 'LoRA 低秩分解原理', tags: ['LLM'] },
        { chunkId: 'a2', noteId: 'nA', text: 'LoRA 微调的另一段', tags: ['LLM'] },
        { chunkId: 'a3', noteId: 'nA', text: 'LoRA 的第三段', tags: ['LLM'] },
        { chunkId: 'b1', noteId: 'nB', text: 'LoRA 量化变体 QLoRA', tags: ['LLM'] },
        { chunkId: 'c1', noteId: 'nC', text: 'LoRA 参数高效微调', tags: ['LLM'] },
      ],
      10
    );

    // 轮询顺序：A 的段落、B 的段落、C 的段落 … 再回 A 的第二段
    expect(results.slice(0, 3).map((r) => r.noteId)).toEqual(['nA', 'nB', 'nC']);
    const notes = new Set(results.map((r) => r.noteId));
    expect(notes.has('nA')).toBe(true);
    expect(notes.has('nB')).toBe(true);
    expect(notes.has('nC')).toBe(true);
  });

  it('整篇挂同一标题的大文档：按 maxSiblingsPerHeading 分段出结果，不并成整篇', async () => {
    // 一篇大文档 8 个子块全在同一个章节标题下（如整本电子书只有一个顶层标题）
    const bigNoteChunks = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
      chunkId: `chunk-${i}`,
      noteId: 'big',
      text: `《中国历代政治得失》关于汉朝制度的片段 ${i}`,
      headingPath: ['中国历代政治得失'],
      tags: ['LLM'],
    }));
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]));

    const results = await strategy.retrieve({ text: '汉朝', tags: ['LLM'] }, bigNoteChunks, 10);

    // 旧行为：8 段并成 1 个巨型父块 → 只出 1 条。现在每 2 段出一段，出现多条分段结果
    expect(results.length).toBeGreaterThanOrEqual(3);
    // 每段都带章节路径，用户能定位到是哪一段命中
    expect(results.every((r) => r.headingPath?.[0] === '中国历代政治得失')).toBe(true);
  });

  it('关键词命中候选标签：正文没这词、但打了对应标签的笔记也能被检索到', async () => {
    // 向量库空（无命中）时，规则层靠「关键词 ↔ 标签」匹配把候选抬过 minScore
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]));
    const candidates: RuleCandidateSource[] = [
      { chunkId: 'c1', noteId: 'n1', text: '这篇正文完全没提微积分', tags: ['微积分'] },
      { chunkId: 'c2', noteId: 'n2', text: '量子力学相关正文', tags: ['物理'] },
    ];

    const results = await strategy.retrieve({ text: '微积分' }, candidates, 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].noteId).toBe('n1');
    expect(results[0].matchedBy).toEqual(['rule']);
  });

  it('关键词命中标签权重高于正文无关的候选：标签分（0.5）单靠即可过 minScore', async () => {
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]));
    // 标签完全命中的候选应排在只靠弱正文相似（低于 minScore）的候选之前
    const candidates: RuleCandidateSource[] = [
      { chunkId: 'weak', noteId: 'nW', text: '一些不相关的日常流水', tags: [] },
      { chunkId: 'tagged', noteId: 'nT', text: '正文没有出现查询词', tags: ['高等数学'] },
    ];

    const results = await strategy.retrieve({ text: '高等数学' }, candidates, 10);

    expect(results.some((r) => r.noteId === 'nT')).toBe(true);
    expect(results.find((r) => r.noteId === 'nT')?.score).toBeGreaterThan(0.18); // minScore 之上
  });

  it('标题命中：正文零重叠但标题相关的笔记也能被召回（记忆模块 vs Agent 组件）', async () => {
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]));
    // 候选正文与查询词毫无重叠，但标题「记忆模块（Memory）」包含「记忆」
    const candidates: RuleCandidateSource[] = [
      { chunkId: 'mem', noteId: 'nMem', title: '记忆模块（Memory）', text: '负责存储与检索过去的交互与知识。', tags: [] },
      { chunkId: 'oth', noteId: 'nOth', title: '买菜清单', text: '鸡蛋、牛奶、面包。', tags: [] },
    ];

    const results = await strategy.retrieve({ text: '记忆模块' }, candidates, 10);

    expect(results.some((r) => r.noteId === 'nMem')).toBe(true);
    expect(results.find((r) => r.noteId === 'nMem')?.title).toBe('记忆模块（Memory）');
    expect(results.some((r) => r.noteId === 'nOth')).toBe(false);
  });
});

describe('RetrievalStrategy cross-encoder 重排（深度检索）', () => {
  // 两段都过 minScore，且 cross-encoder 与启发式顺序不同，才能看出谁在生效
  const rerankCandidates: RuleCandidateSource[] = [
    { chunkId: 'c1', noteId: 'n1', text: 'LoRA 低秩分解原理', tags: ['LLM'] },
    { chunkId: 'c2', noteId: 'n2', text: 'QLoRA 是 LoRA 的量化变体', tags: ['LLM'] },
  ];

  it('有 cross-encoder 时优先用它重排，生成式不参与', async () => {
    let generativeCalls = 0;
    const crossEncoder: RerankProvider = {
      rerank: async (_query, docs) => docs.map((_, i) => (i === 1 ? 0.9 : 0.1)),
    };
    const reranker = new ReRanker(
      new ModelRouter({
        isAvailable: async () => true,
        complete: async () => {
          generativeCalls += 1;
          return JSON.stringify([
            { id: 'c1', score: 9 },
            { id: 'c2', score: 1 },
          ]);
        },
      })
    );
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]), defaultWeights, {
      crossEncoder,
      reranker,
    });

    const results = await strategy.retrieve(
      { text: 'LoRA', tags: ['LLM'], deep: true },
      rerankCandidates,
      10
    );

    expect(generativeCalls).toBe(0);
    expect(results[0].chunkId).toBe('c2'); // cross-encoder 把第二段排到最前
  });

  it('cross-encoder 失败时回退生成式 ReRanker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crossEncoder: RerankProvider = {
      rerank: async () => {
        throw new Error('rerank 服务未启动');
      },
    };
    const reranker = new ReRanker(
      new ModelRouter({
        isAvailable: async () => true,
        complete: async () =>
          JSON.stringify([
            { id: 'c1', score: 9 },
            { id: 'c2', score: 1 },
          ]),
      })
    );
    const strategy = new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([]), defaultWeights, {
      crossEncoder,
      reranker,
    });

    const results = await strategy.retrieve(
      { text: 'LoRA', tags: ['LLM'], deep: true },
      rerankCandidates,
      10
    );

    expect(results[0].chunkId).toBe('c1'); // 生成式重排把 c1 排到最前
    warn.mockRestore();
  });
});

const candidates: RetrievalCandidate[] = [
  { chunkId: 'c1', noteId: 'n1', text: 'LoRA 低秩分解', score: 0.8, matchedBy: ['rule'] },
  { chunkId: 'c2', noteId: 'n2', text: 'QLoRA 4bit 量化', score: 0.7, matchedBy: ['vector'] },
];

const routerWith = (response: string): ModelRouter => {
  const provider: ModelProvider = { isAvailable: async () => true, complete: async () => response };
  return new ModelRouter(provider);
};

describe('RelationJudge', () => {
  const validSuggestion = {
    toId: 'c1',
    relationType: 'prerequisite',
    reason: '理解 QLoRA 前需要先掌握 LoRA',
    confidence: 0.85,
  };

  it('补齐 toNoteId 与摘要，供 UI 解释为什么相关', async () => {
    const judge = new RelationJudge(routerWith(JSON.stringify([validSuggestion])));

    const { ok, suggestions } = await judge.judge('QLoRA 是什么', candidates);

    expect(ok).toBe(true);
    expect(suggestions[0]).toMatchObject({ toId: 'c1', toNoteId: 'n1', toType: 'chunk' });
    expect(suggestions[0].excerpt).toBeTruthy();
  });

  it('过滤模型编造的候选 id', async () => {
    const judge = new RelationJudge(
      routerWith(JSON.stringify([{ ...validSuggestion, toId: 'c_不存在' }]))
    );

    const { ok, suggestions } = await judge.judge('QLoRA', candidates);

    expect(ok).toBe(true);
    expect(suggestions).toEqual([]);
  });

  it('过滤低置信度建议（宁缺勿滥）', async () => {
    const judge = new RelationJudge(
      routerWith(JSON.stringify([{ ...validSuggestion, confidence: 0.3 }]))
    );

    const { suggestions } = await judge.judge('QLoRA', candidates);

    expect(suggestions).toEqual([]);
  });

  it('候选为空时不调用模型', async () => {
    const complete = vi.fn();
    const judge = new RelationJudge(new ModelRouter({ isAvailable: async () => true, complete }));

    const { ok, suggestions } = await judge.judge('QLoRA', []);

    expect(ok).toBe(true);
    expect(suggestions).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('模型不可用时 ok=false，区别于「确实没有关系」', async () => {
    const judge = new RelationJudge(
      new ModelRouter({
        isAvailable: async () => false,
        complete: async () => '',
      })
    );

    const { ok, suggestions } = await judge.judge('QLoRA', candidates);

    expect(ok).toBe(false);
    expect(suggestions).toEqual([]);
  });

  it('最多返回 maxLinks 条，按置信度取高的', async () => {
    const judge = new RelationJudge(
      routerWith(
        JSON.stringify([
          { ...validSuggestion, toId: 'c1', confidence: 0.7 },
          { ...validSuggestion, toId: 'c2', confidence: 0.95 },
        ])
      ),
      { maxLinks: 1, minConfidence: 0.6 }
    );

    const { suggestions } = await judge.judge('QLoRA', candidates);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].toId).toBe('c2');
  });
});

describe('RAGOrchestrator', () => {
  const candidateProvider: CandidateProvider = {
    listCandidates: async () => ruleCandidates,
  };

  const build = (response: string) => {
    const router = routerWith(response);
    return new RAGOrchestrator(
      new RetrievalStrategy(
        fakeEmbedding(),
        fakeVectorStore([{ chunkId: 'c1', noteId: 'n1', text: ruleCandidates[0].text, score: 0.9 }])
      ),
      new RelationJudge(router),
      candidateProvider
    );
  };

  it('findConnections 同时返回候选与建议', async () => {
    const rag = build(
      JSON.stringify([{ toId: 'c1', relationType: 'extends', reason: '延伸内容', confidence: 0.8 }])
    );

    const result = await rag.findConnections({ text: 'LoRA 低秩分解', tags: ['LLM'] });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.suggestions).toHaveLength(1);
    expect(result.relationJudged).toBe(true);
  });

  it('没有候选时不进入模型层', async () => {
    const complete = vi.fn();
    const rag = new RAGOrchestrator(
      new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([])),
      new RelationJudge(new ModelRouter({ isAvailable: async () => true, complete })),
      { listCandidates: async () => [] }
    );

    const result = await rag.findConnections({ text: '无关查询' });

    expect(result.candidates).toEqual([]);
    expect(result.relationJudged).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('检索零命中时用 listFallback 兜底：标题相关的最近笔记也能进模型层判断', async () => {
    const complete = vi.fn(async () =>
      JSON.stringify([
        { toId: 'fb1', relationType: 'same_concept', reason: '都是 Agent 的记忆组件', confidence: 0.8 },
      ])
    );
    const rag = new RAGOrchestrator(
      new RetrievalStrategy(fakeEmbedding(), fakeVectorStore([])),
      new RelationJudge(new ModelRouter({ isAvailable: async () => true, complete })),
      {
        listCandidates: async () => [], // 字面检索零命中
        listFallback: async () => [
          { chunkId: 'fb1', noteId: 'nMem', title: '记忆模块（Memory）', text: '负责存储与检索过去的交互。', tags: [] },
          { chunkId: 'fb2', noteId: 'nAgent', title: '单 Agent 四大核心组件', text: '记忆、规划、工具与行动。', tags: [] },
        ],
      }
    );

    const result = await rag.findConnections({ text: '记忆模块' });

    // 兜底候选进入了模型层：模型能看到标题与首段，产出语义关联建议
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({ title: '记忆模块（Memory）' });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ toId: 'fb1', toNoteId: 'nMem' });
  });
});

describe('chunk 切分', () => {
  it('Markdown 按标题层级切分并保留标题路径', () => {
    const chunks = chunkMarkdown(
      ['# 大模型微调', '', '概述段落内容。', '', '## LoRA', '', '低秩分解的做法。'].join('\n')
    );

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].headingPath).toEqual(['大模型微调']);
    expect(chunks[chunks.length - 1].headingPath).toEqual(['大模型微调', 'LoRA']);
  });

  it('切换到更浅的标题层级时正确收起标题栈', () => {
    const chunks = chunkMarkdown(
      ['# A', '', 'a 内容', '', '## A1', '', 'a1 内容', '', '# B', '', 'b 内容'].join('\n')
    );

    expect(chunks[chunks.length - 1].headingPath).toEqual(['B']);
  });

  it('超长段落被硬切，不产生巨型 chunk', () => {
    const chunks = chunkPlainText('字'.repeat(5000));

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(1500));
  });

  it('过短的相邻 chunk 被合并，避免碎片', () => {
    const chunks = chunkPlainText('短句一。\n\n短句二。\n\n短句三。');

    expect(chunks).toHaveLength(1);
  });

  it('空文本产出空数组', () => {
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('offset 单调不减，可回溯原文位置', () => {
    const chunks = chunkPlainText(
      Array.from({ length: 6 }, (_, i) => `${'内容'.repeat(250)}${i}`).join('\n\n')
    );

    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].offset).toBeGreaterThanOrEqual(chunks[i - 1].offset);
    }
  });
});
