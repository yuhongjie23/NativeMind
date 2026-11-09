import { DeepQAAdapter } from '@ai/adapters';
/**
 * Self-RAG 深度问答测试
 *
 * 关注点：
 * - 检索 → 生成 → 评判 → 重生成循环的编排正确
 * - 评判不达标时带意见重生成一次（maxRefine）
 * - 评判失败 / 生成失败 / 无候选的降级路径（绝不抛错、绝不阻塞）
 * - citations 与评判器 used_chunk_ids 对齐
 */
import { describe, expect, it, vi } from 'vitest';
import { SelfRag, type SelfCritique } from '@ai/rag/self-rag';
import type { RAGOrchestrator } from '@ai/rag/rag-orchestrator';
import type { RetrievalCandidate } from '@ai/rag/retrieval-strategy';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest, ModelProvider } from '@ai/types';

const candidates: RetrievalCandidate[] = [
  { chunkId: 'c1', noteId: 'n1', text: 'LoRA 通过低秩分解减少可训练参数量', score: 0.8, matchedBy: ['rule'] },
  { chunkId: 'c2', noteId: 'n2', text: 'QLoRA 用 4bit 量化进一步降低显存占用', score: 0.7, matchedBy: ['vector'] },
];

/** 只 mock retrieve，SelfRag 不碰其它编排逻辑 */
const fakeRag = (result: RetrievalCandidate[]): RAGOrchestrator =>
  ({ retrieve: async () => result }) as unknown as RAGOrchestrator;

/** 按请求内容路由的假 provider：system 含「质量评审」→ 评判任务，否则生成任务 */
const routerWith = (handler: (req: ModelCompletionRequest) => string): ModelRouter => {
  const provider: ModelProvider = {
    isAvailable: async () => true,
    complete: async (req) => handler(req),
  };
  return new ModelRouter(provider);
};

const isCritic = (req: ModelCompletionRequest): boolean =>
  (req.system ?? '').includes('质量评审');

const groundedCritic: SelfCritique = {
  relevance: 0.9,
  grounded: true,
  hallucination_risk: false,
  quality: 8,
  used_chunk_ids: ['c1'],
  evidence: [{ chunk_id: 'c1', quote: candidates[0].text, claim: '低秩分解' }],
  critique: '',
};

describe('SelfRag', () => {
  it('保留长片段后半部分的证据，避免引用有内容但生成看不到', async () => {
    const text = '背景。'.repeat(200) + '关键证据：关心、责任心、尊重和了解。';
    const router = routerWith(req => {
      expect(req.prompt).toContain('关键证据：关心、责任心、尊重和了解。');
      return isCritic(req) ? JSON.stringify(groundedCritic) : '关心、责任心、尊重和了解。';
    });
    const result = await new SelfRag(router, fakeRag([{ ...candidates[0], text }])).ask('基本要素是什么？');
    expect(result.ok).toBe(true);
  });
  it('happy path：生成 → 评判通过 → 返回答案、置信度与对齐后的引用', async () => {
    const router = routerWith((req) =>
      isCritic(req)
        ? JSON.stringify(groundedCritic)
        : 'LoRA 是一种低秩分解方法，用于高效微调大模型。'
    );

    const result = await new SelfRag(router, fakeRag(candidates)).ask('LoRA 是什么');

    expect(result.ok).toBe(true);
    expect(result.empty).toBe(false);
    expect(result.judged).toBe(true);
    expect(result.regenerated).toBe(false);
    expect(result.answer).toContain('低秩分解');
    // relevance 0.9 * 0.6 + quality 8/10 * 0.4 = 0.86
    expect(result.confidence).toBeCloseTo(0.86);
    // citations 与 used_chunk_ids 对齐（只保留 c1）
    expect(result.citations.map((c) => c.chunkId)).toEqual(['c1']);
  });

  it('评判不达标 → 带意见重生成一次 → 再评判通过', async () => {
    let generateCount = 0;
    let criticCount = 0;
    const router = routerWith((req) => {
      if (isCritic(req)) {
        criticCount += 1;
        return criticCount === 1
          ? JSON.stringify({ ...groundedCritic, grounded: false, critique: '答案未引用任何资料' })
          : JSON.stringify(groundedCritic);
      }
      generateCount += 1;
      return generateCount === 1 ? '凭感觉编的答案' : '严格依据 c1 资料的答案：低秩分解';
    });

    const result = await new SelfRag(router, fakeRag(candidates)).ask('LoRA 是什么');

    expect(result.regenerated).toBe(true);
    expect(result.judged).toBe(true);
    expect(generateCount).toBe(2);
    expect(criticCount).toBe(2);
    expect(result.answer).toBe('低秩分解 [1]');
  });

  it('评判失败（输出不合法）→ 不将草稿作为确定答案，judged=false，不冒充已有支持性引用', async () => {
    const router = routerWith((req) => (isCritic(req) ? '模型输出了无关内容' : '一个回答'));

    const result = await new SelfRag(router, fakeRag(candidates)).ask('问题');

    expect(result.ok).toBe(true);
    expect(result.judged).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.answer).toContain('证据核验未完成');
    expect(result.answer).not.toContain('一个回答');
    expect(result.citations).toEqual([]);
  });

  it.each([
    { ...groundedCritic, used_chunk_ids: [] },
    { ...groundedCritic, used_chunk_ids: ['invented'] },
    { ...groundedCritic, grounded: false, quality: 10, relevance: 1 },
    { ...groundedCritic, hallucination_risk: true, quality: 10, relevance: 1 },
  ])('无有效依据或仍存在编造风险时不返回高分和候选引用', async critique => {
    const router = routerWith(req => isCritic(req) ? JSON.stringify(critique) : '资料不足');
    const result = await new SelfRag(router, fakeRag(candidates)).ask('资料没有回答的问题');
    expect(result.judged).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('生成失败（模型不可用）→ 降级为最相关片段，ok=false，不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const router = routerWith(() => '');

    const result = await new SelfRag(router, fakeRag(candidates)).ask('LoRA 是什么');

    expect(result.ok).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.judged).toBe(false);
    expect(result.answer).toContain('LoRA'); // 顶部候选片段作最佳努力
    warn.mockRestore();
  });

  it('流式：生成时 onToken 增量回调，最终答案以返回值为主', async () => {
    const deltas: string[] = [];
    const router = routerWith((req) => {
      if (isCritic(req)) return JSON.stringify(groundedCritic);
      req.onToken?.('你');
      req.onToken?.('好');
      return '你好，这是答案：低秩分解';
    });

    const result = await new SelfRag(router, fakeRag(candidates)).ask('问题', {
      onToken: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['你', '好']);
    expect(result.answer).toBe('低秩分解 [1]');
  });

  it('无相关候选 → 返回 empty，不调模型', async () => {
    const router = routerWith(() => {
      throw new Error('无候选时不应调用模型');
    });

    const result = await new SelfRag(router, fakeRag([])).ask('不存在的话题');

    expect(result.empty).toBe(true);
    expect(result.answer).toBe('');
    expect(result.citations).toEqual([]);
  });
});

 it.each([
   { evidence: [{ chunk_id: 'c1', quote: 'fabricated quote', claim: '低秩分解' }] },
   { evidence: [{ chunk_id: 'invented', quote: candidates[0].text, claim: '低秩分解' }] },
   { evidence: [{ chunk_id: 'c1', quote: candidates[0].text, claim: 'not in the answer' }] },
   { evidence: [] },
 ])('does not present unsupported statements as an answer: %j', async ({ evidence }) => {
   const router = routerWith(req => isCritic(req) ? JSON.stringify({ ...groundedCritic, evidence }) : '低秩分解的发明者是一个编造的人');
   const result = await new SelfRag(router, fakeRag(candidates)).ask('Who invented it?');
   expect(result.citations).toEqual([]);
   expect(result.confidence).toBe(0);
   expect(result.answer).toContain('资料不足');
   expect(result.answer).not.toContain('编造的人');
 });
 it('returns the exact source quote paired with a statement that appears in the answer', async () => {
   const result = await new SelfRag(routerWith(req => isCritic(req) ? JSON.stringify(groundedCritic) : 'LoRA 使用低秩分解。'), fakeRag(candidates)).ask('LoRA?');
   expect(result.citations[0].text).toBe(candidates[0].text);
   expect(result.citations[0].supportingClaim).toBe('低秩分解');
 });

 it('drops unsupported trailing sentences even when another sentence has evidence', async () => {
   const result = await new SelfRag(routerWith(req => isCritic(req) ? JSON.stringify(groundedCritic) : '低秩分解。作者是杜撰人物。'), fakeRag(candidates)).ask('Explain');
   expect(result.answer).toBe('低秩分解 [1]');
   expect(result.answer).not.toContain('杜撰');
 });
 it('keeps multiple claim pairs from one chunk and adjusts source offsets to the quote', async () => {
   const text = '背景内容。第一项证据。第二项证据。';
   const evidence = [
     { chunk_id: 'c1', quote: '第一项证据', claim: '第一项结论' },
     { chunk_id: 'c1', quote: '第二项证据', claim: '第二项结论' },
   ];
   const router = routerWith(req => isCritic(req) ? JSON.stringify({ ...groundedCritic, evidence: [...evidence, evidence[0]] }) : '第一项结论。第二项结论。');
   const result = await new SelfRag(router, fakeRag([{ ...candidates[0], text, charStart: 100 }])).ask('Compare');
   expect(result.citations).toHaveLength(2);
   expect(result.citations.map(c => c.charStart)).toEqual([100 + text.indexOf('第一项证据'), 100 + text.indexOf('第二项证据')]);
   expect(result.answer).toBe('第一项结论 [1]\n\n第二项结论 [2]');
 });

 it('preserves the statement and quote offset through the application adapter', async () => {
   const rag = new SelfRag(routerWith(req => isCritic(req) ? JSON.stringify(groundedCritic) : '低秩分解'), fakeRag([{ ...candidates[0], charStart: 42 }]));
   const answer = await new DeepQAAdapter(rag).ask({ question: 'LoRA?' });
   expect(answer.citations[0]).toMatchObject({ supportingClaim: '低秩分解', charStart: 42, text: candidates[0].text });
 });
