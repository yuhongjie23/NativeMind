/**
 * 搜索门禁测试（§14 + C6）
 *
 * 这是隐私边界的守门人，测试重点是「该拦的都拦住了」，
 * 以及放行时出站载荷只有关键词、没有笔记原文。
 */
import { describe, expect, it, vi } from 'vitest';
import { ModelRouter } from '@ai/router/model-router';
import { KeywordGenerator } from '@ai/search/keyword-generator';
import { ResultFilter, coarseFilter, type RawSearchResult } from '@ai/search/result-filter';
import { SearchGate, evaluateGate, type GateContext, type SearchProvider } from '@ai/search/search-gate';
import type { ModelProvider } from '@ai/types';

const allowAll: GateContext = {
  trigger: 'user_explicit',
  focusAllows: true,
  privacyAllows: true,
  userConfirmed: true,
};

describe('evaluateGate 三道闸', () => {
  it('四个条件齐备才放行', () => {
    expect(evaluateGate(allowAll)).toEqual({ allowed: true });
  });

  it.each(['user_explicit', 'local_insufficient_confirmed', 'review_supplement'] as const)(
    '合法触发场景 %s 放行',
    (trigger) => {
      expect(evaluateGate({ ...allowAll, trigger }).allowed).toBe(true);
    }
  );

  it('非法触发场景一律拒绝（比如只是在记笔记）', () => {
    const decision = evaluateGate({ ...allowAll, trigger: 'note_taking' as never });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('不允许');
  });

  it('专注期间拒绝，理由说明是推迟不是失败（C4）', () => {
    const decision = evaluateGate({ ...allowAll, focusAllows: false });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('专注');
  });

  it('隐私策略关闭时拒绝，并透传具体原因（C6）', () => {
    const decision = evaluateGate({
      ...allowAll,
      privacyAllows: false,
      privacyReason: '离线模式已开启',
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('离线模式已开启');
  });

  it('未确认时拒绝：联网必须用户点头', () => {
    const decision = evaluateGate({ ...allowAll, userConfirmed: false });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('确认');
  });

  it('专注优先于隐私提示，先报专注', () => {
    const decision = evaluateGate({ ...allowAll, focusAllows: false, privacyAllows: false });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('专注');
  });
});

/** 按调用顺序返回预设响应的假模型 */
const scriptedProvider = (responses: string[]): ModelProvider => {
  let i = 0;
  return {
    isAvailable: async () => true,
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
};

const unavailableProvider: ModelProvider = {
  isAvailable: async () => false,
  complete: async () => {
    throw new Error('不该被调用');
  },
};

const fakeSearchProvider = (results: RawSearchResult[]): SearchProvider & { queries: string[] } => {
  const queries: string[] = [];
  return {
    queries,
    search: async (query) => (queries.push(query), { results }),
  };
};

const sampleResults: RawSearchResult[] = [
  {
    title: 'LoRA 与 QLoRA 的显存开销对比',
    url: 'https://example.com/a',
    snippet: '本文实测了两种微调方式在 7B 模型上的显存占用差异，并给出复现脚本。',
    publishedAt: new Date().toISOString(),
    site: 'example.com',
  },
  {
    title: 'QLoRA 论文精读',
    url: 'https://blog.dev/b',
    snippet: '逐节拆解 QLoRA 的 4bit 量化与分页优化器设计，附公式推导过程说明。',
    publishedAt: new Date().toISOString(),
    site: 'blog.dev',
  },
];

const buildGate = (provider: ModelProvider, searchProvider: SearchProvider) => {
  const router = new ModelRouter(provider);
  return new SearchGate(searchProvider, new KeywordGenerator(router), new ResultFilter(router));
};

describe('SearchGate 出站行为', () => {
  it('门禁未通过时一次都不联网', async () => {
    const searchProvider = fakeSearchProvider(sampleResults);
    const gate = buildGate(scriptedProvider(['[]']), searchProvider);

    const outcome = await gate.search('LoRA', { ...allowAll, userConfirmed: false });

    expect(outcome.allowed).toBe(false);
    expect(outcome.results).toEqual([]);
    expect(searchProvider.queries).toHaveLength(0);
  });

  it('放行后出站载荷只含关键词，不含笔记原文（C6）', async () => {
    const searchProvider = fakeSearchProvider(sampleResults);
    const gate = buildGate(
      scriptedProvider([
        JSON.stringify(['LoRA QLoRA 显存对比']),
        JSON.stringify([{ index: 0, score: 0.9, reason: '有实测数据' }]),
      ]),
      searchProvider
    );

    const outcome = await gate.search('LoRA 和 QLoRA 有什么区别', allowAll, ['显存开销']);

    expect(outcome.allowed).toBe(true);
    expect(searchProvider.queries).toEqual(['LoRA QLoRA 显存对比']);
    expect(outcome.results[0].reason).toBe('有实测数据');
  });

  it('模型不可用时用本地关键词兜底，联网功能不整体失效', async () => {
    const searchProvider = fakeSearchProvider(sampleResults);
    const gate = buildGate(unavailableProvider, searchProvider);

    const outcome = await gate.search('QLoRA 量化原理', allowAll);

    expect(outcome.allowed).toBe(true);
    expect(outcome.keywordFallback).toBe(true);
    expect(searchProvider.queries).toHaveLength(1);
    // 精排也失败了，但粗筛结果照样能用
    expect(outcome.rankingSkipped).toBe(true);
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  it('单条检索式失败不影响整体', async () => {
    let call = 0;
    const searchProvider: SearchProvider = {
      search: async () => {
        call += 1;
        if (call === 1) throw new Error('网络超时');
        return { results: sampleResults };
      },
    };
    const gate = buildGate(
      scriptedProvider([JSON.stringify(['查询一', '查询二']), JSON.stringify([{ index: 0, score: 0.8, reason: 'ok' }])]),
      searchProvider
    );

    const outcome = await gate.search('LoRA', allowAll);

    expect(outcome.allowed).toBe(true);
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  it('搜索无结果时明确告知，而不是假装成功', async () => {
    const gate = buildGate(scriptedProvider([JSON.stringify(['LoRA'])]), fakeSearchProvider([]));

    const outcome = await gate.search('LoRA', allowAll);

    expect(outcome.allowed).toBe(true);
    expect(outcome.results).toEqual([]);
    expect(outcome.reason).toContain('没有返回结果');
  });
});

describe('coarseFilter 规则粗筛', () => {
  it('URL 去重时忽略查询参数与尾斜杠', () => {
    const filtered = coarseFilter([
      { title: 'A', url: 'https://x.com/p' },
      { title: 'A 重复', url: 'https://x.com/p/?utm_source=weixin' },
    ]);

    expect(filtered).toHaveLength(1);
  });

  it('同站最多保留 2 条，避免一个站霸榜', () => {
    const filtered = coarseFilter([
      { title: '1', url: 'https://same.com/1' },
      { title: '2', url: 'https://same.com/2' },
      { title: '3', url: 'https://same.com/3' },
      { title: '4', url: 'https://other.com/1' },
    ]);

    expect(filtered.filter((r) => r.url.includes('same.com'))).toHaveLength(2);
    expect(filtered).toHaveLength(3);
  });

  it('丢弃缺标题或缺 URL 的脏数据', () => {
    const filtered = coarseFilter([
      { title: '', url: 'https://x.com/1' },
      { title: '有效', url: 'https://x.com/2' },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('有效');
  });

  it('新内容排在陈旧内容之前', () => {
    const filtered = coarseFilter([
      { title: '旧', url: 'https://a.com/old', publishedAt: '2015-01-01T00:00:00Z' },
      { title: '新', url: 'https://b.com/new', publishedAt: new Date().toISOString() },
    ]);

    expect(filtered[0].title).toBe('新');
  });

  it('疑似内容农场的链接被降权', () => {
    const filtered = coarseFilter([
      { title: '下载页', url: 'https://csdn.net/download/xyz' },
      { title: '正经文章', url: 'https://good.com/post' },
    ]);

    expect(filtered[0].title).toBe('正经文章');
  });
});

describe('ResultFilter 精排', () => {
  it('模型编造的越界下标被忽略', async () => {
    const router = new ModelRouter(
      scriptedProvider([JSON.stringify([{ index: 99, score: 0.9, reason: '不存在的条目' }])])
    );
    const filter = new ResultFilter(router);

    const { results, rankingSkipped } = await filter.refine('LoRA', sampleResults, 5);

    // 一条都没匹配上，退回粗筛结果
    expect(rankingSkipped).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('最终得分是规则分与模型分的平均，模型不能单方面捧高低质结果', async () => {
    const router = new ModelRouter(
      scriptedProvider([JSON.stringify([{ index: 0, score: 1, reason: '很相关' }])])
    );

    const { results } = await new ResultFilter(router).refine('LoRA', sampleResults, 1);

    expect(results[0].score).toBeLessThan(1);
    expect(results[0].score).toBeGreaterThan(0.5);
  });

  it('候选为空时不调用模型', async () => {
    const complete = vi.fn();
    const router = new ModelRouter({ isAvailable: async () => true, complete });

    const { results } = await new ResultFilter(router).refine('LoRA', [], 5);

    expect(results).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});
