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
  critique: '',
};

describe('SelfRag', () => {
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
      return generateCount === 1 ? '凭感觉编的答案' : '严格依据 c1 资料的答案';
    });

    const result = await new SelfRag(router, fakeRag(candidates)).ask('LoRA 是什么');

    expect(result.regenerated).toBe(true);
    expect(result.judged).toBe(true);
    expect(generateCount).toBe(2);
    expect(criticCount).toBe(2);
    expect(result.answer).toContain('严格依据');
  });

  it('评判失败（输出不合法）→ 接受当前草稿，judged=false，中性置信度，引用回退全部候选', async () => {
    const router = routerWith((req) => (isCritic(req) ? '模型输出了无关内容' : '一个回答'));

    const result = await new SelfRag(router, fakeRag(candidates)).ask('问题');

    expect(result.ok).toBe(true);
    expect(result.judged).toBe(false);
    expect(result.confidence).toBe(0.5);
    expect(result.citations.map((c) => c.chunkId)).toEqual(['c1', 'c2']);
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
      return '你好，这是答案';
    });

    const result = await new SelfRag(router, fakeRag(candidates)).ask('问题', {
      onToken: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['你', '好']);
    expect(result.answer).toBe('你好，这是答案');
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
