import { describe, expect, it, vi } from 'vitest';
import { verifyReview } from '@ai/rag/verify-review';
import { ModelRouter } from '@ai/router/model-router';
import { ReviewGeneratorAdapter } from '@ai/adapters';
import type { ReviewEvidenceSource, ReviewObservation, Todo } from '@application/ports';
import type { ModelCompletionRequest } from '@ai/types';
import type { JsonSchema } from '@ai/evaluation/json-validator';

const source: ReviewEvidenceSource = { id: 'task:t', kind: 'task', description: '「二分查找」：截至区间末已完成，记录的完成时间 2026-11-05T09:00:00+08:00' };
const observation: ReviewObservation = { text: '完成二分查找任务', evidenceIds: ['task:t'] };
const verdict = { kind: 'observation', index: 0, evidenceId: source.id, quote: '截至区间末已完成' };
const routerWith = (accepted: unknown[]) => new ModelRouter({ isAvailable: async () => true, complete: async () => JSON.stringify({ accepted }) });

describe('复盘逐句证据核验', () => {
  it('既不把缺失采集当观察，也不建议用户补录完成时间', async () => {
    const complete = vi.fn(async () => JSON.stringify({ accepted: [] }));
    const result = await verifyReview(new ModelRouter({ isAvailable: async () => true, complete }), [source],
      [{ text: '未记录应用使用情况', evidenceIds: ['task:t'] }],
      [{ text: '确认是否在区间内完成', evidenceIds: ['task:t'] }]);
    expect(result).toEqual({ observations: [], suggestions: [], available: true });
    expect(complete).not.toHaveBeenCalled();
  });
  it('只保留通过项，去重，并拒绝假引文、跨来源引用与越界序号', async () => {
    const other: ReviewEvidenceSource = { ...source, id: 'task:other' };
    const result = await verifyReview(routerWith([
      verdict, verdict, { ...verdict, index: 1, quote: '不存在的引文' }, { ...verdict, index: 2, evidenceId: other.id },
    ]), [source, other], [observation, { ...observation, text: '虚构进步' }, { ...observation, text: '已掌握' }], []);
    expect(result.observations).toEqual([{ ...observation, text: '资料记录：「截至区间末已完成」' }]);
    expect((await verifyReview(routerWith([{ ...verdict, index: 2 }]), [source], [observation], [])).observations).toEqual([]);
  });

  it('采集覆盖率不能支持观察；区间统计不能支持学习建议', async () => {
    const coverage: ReviewEvidenceSource = { id: 'coverage', kind: 'coverage', description: '未记录应用使用' };
    const period: ReviewEvidenceSource = { id: 'period', kind: 'period', description: '本地记录任务一项' };
    const result = await verifyReview(routerWith([
      { ...verdict, evidenceId: coverage.id, quote: coverage.description },
      { ...verdict, kind: 'suggestion', evidenceId: period.id, quote: period.description },
    ]), [coverage, period], [{ text: '未使用软件', evidenceIds: ['coverage'] }], [{ text: '增加学习时间', evidenceIds: ['period'] }]);
    expect(result.observations).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('核验不可用只展示程序事实，不泄漏未经核验的正文、总结、观察或建议', async () => {
    const complete = vi.fn(async (request: ModelCompletionRequest) => {
      if ((request.jsonSchema as JsonSchema | undefined)?.$id === 'review-check.v1') throw new Error('verifier unavailable');
      return JSON.stringify({ content: '你已经完全掌握所有知识', summary: '进步巨大', observations: [observation],
        nextSteps: [{ text: '回顾二分查找', evidenceIds: ['task:t'] }], limitations: ['你没有学习'] });
    });
    const todo: Todo = { id: 't', title: '二分查找', status: 'completed', completedAt: '2026-11-05T09:00:00+08:00',
      createdAt: '2026-11-05T08:00:00+08:00', updatedAt: '2026-11-05T09:00:00+08:00', tags: [], linkedNoteIds: [] };
    const output = await new ReviewGeneratorAdapter(new ModelRouter({ isAvailable: async () => true, complete }))
      .generate({ reviewType: 'daily', date: '2026-11-05', todos: [todo], focusSessions: [] });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(output.insights).toEqual([]);
    expect(output.nextTodos).toEqual([]);
    expect(output.content).toContain('本地记录');
    expect(output.evidence?.limitations[0]).toContain('证据核验未完成');
    expect(JSON.stringify(output)).not.toMatch(/完全掌握|进步巨大|你没有学习/);
  });

  it('核验取消向上传递，不把取消写成可保存的复盘', async () => {
    const controller = new AbortController();
    const router = new ModelRouter({ isAvailable: async () => true, complete: async () => {
      controller.abort(); throw new DOMException('cancelled', 'AbortError');
    } });
    await expect(verifyReview(router, [source], [observation], [], { signal: controller.signal })).rejects.toThrow();
  });

  it('格式错误不放过草稿、不重试或切换模型', async () => {
    const complete = vi.fn(async () => '{"accepted":"all"}');
    const result = await verifyReview(new ModelRouter({ isAvailable: async () => true, complete }), [source], [observation], []);
    expect(result).toEqual({ observations: [], suggestions: [], available: false });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
