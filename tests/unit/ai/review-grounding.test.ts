import { describe, expect, it, vi } from 'vitest';
import { ReviewGeneratorAdapter } from '@ai/adapters';
import { ModelRouter } from '@ai/router/model-router';
import { buildReviewEvidence } from '@ai/rag/review-evidence';
import type { ModelCompletionRequest } from '@ai/types';
import type { Todo } from '@application/ports';

const todo: Todo = { id: 't1', title: '读第三章', status: 'completed', tags: [], linkedNoteIds: [],
  createdAt: '2026-11-05T01:00:00+08:00', updatedAt: '2026-11-05T02:00:00+08:00', completedAt: '2026-11-05T02:00:00+08:00' };
const draft = { content: '记录显示阅读任务已完成，掌握程度还需要自查。', summary: '完成阅读',
  observations: [{ text: '完成了阅读任务', evidenceIds: ['task:t1'] }],
  nextSteps: [{ text: '回顾第三章', evidenceIds: ['task:t1'] }], limitations: ['没有掌握程度的记录'] };

describe('有据复盘', () => {
  it('完全无学习记录时不调用模型、不凑观察或建议', async () => {
    const complete = vi.fn(async () => '不应调用');
    const result = await new ReviewGeneratorAdapter(new ModelRouter({ isAvailable: async () => true, complete }))
      .generate({ reviewType: 'daily', date: '2026-11-05', todos: [], focusSessions: [] });
    expect(complete).not.toHaveBeenCalled();
    expect(result.insights).toEqual([]);
    expect(result.nextTodos).toEqual([]);
    expect(result.content).toContain('没有记录不代表没有学习');
  });
  it('保留引用快照，后续改变原任务不改变复盘依据', async () => {
    const complete = vi.fn(async (_request: ModelCompletionRequest) => JSON.stringify(draft));
    const adapter = new ReviewGeneratorAdapter(new ModelRouter({ isAvailable: async () => true, complete }));
    const original = { ...todo };
    const result = await adapter.generate({ reviewType: 'daily', date: '2026-11-05', todos: [original], focusSessions: [] });
    expect(result.nextTodos).toEqual(['回顾第三章']);
    expect(result.evidence?.observations[0].evidenceIds).toEqual(['task:t1']);
    original.title = '改名后的任务';
    expect(result.evidence?.sources.find(source => source.id === 'task:t1')?.description).toContain('读第三章');
    expect(complete.mock.calls[0][0].prompt).toContain('2026-11-05 至 2026-11-05（1 天）');
  });

  it('不存在的证据编号不能进入保存草稿或待办建议', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const adapter = new ReviewGeneratorAdapter(new ModelRouter({ isAvailable: async () => true,
        complete: async () => JSON.stringify({ ...draft, nextSteps: [{ text: '虚构建议', evidenceIds: ['invented'] }] }) }));
      const result = await adapter.generate({ reviewType: 'daily', date: '2026-11-05', todos: [todo], focusSessions: [] });
      expect(result.nextTodos).toEqual([]);
      expect(result.content).not.toContain('虚构建议');
      expect(result.evidence?.limitations[0]).toContain('仅展示程序统计');
    } finally { warn.mockRestore(); }
  });

  it('已有采用后待完成的任务时不继续叠加模型建议', async () => {
    const adapter = new ReviewGeneratorAdapter(new ModelRouter({ isAvailable: async () => true, complete: async () => JSON.stringify(draft) }));
    const result = await adapter.generate({ reviewType: 'daily', date: '2026-11-05', todos: [todo], focusSessions: [],
      followUps: [{ id: 'a1', reviewId: 'r1', suggestion: '回顾第三章', status: 'pending', adoptedAt: '2026-11-05T00:00:00Z' }] });
    expect(result.nextTodos).toEqual([]);
    expect(result.evidence?.suggestions).toEqual([]);
    expect(result.insights).toEqual(['完成了阅读任务']);
  });

  it('稀疏记录允许空观察、空建议，当前采用状态进入独立来源', async () => {
    let prompt = '';
    const adapter = new ReviewGeneratorAdapter(new ModelRouter({ isAvailable: async () => true, complete: async req => {
      prompt = req.prompt;
      return JSON.stringify({ content: '本期记录不足，无法判断学习情况。', summary: '', observations: [], nextSteps: [], limitations: ['没有学习记录'] });
    } }));
    const result = await adapter.generate({ reviewType: 'monthly', date: '2026-11-05', dates: ['2026-11-05', '2026-11-04'], todos: [], focusSessions: [],
      followUps: [{ id: 'adopted', reviewId: 'r1', suggestion: '读第三章', adoptedAt: '2026-11-04T10:00:00Z', status: 'completed' }] });
    expect(result.insights).toEqual([]);
    expect(prompt).toContain('2026-11-04 至 2026-11-05（2 天）');
    expect(prompt).toContain('followup:adopted');
    expect(prompt).toContain('不证明建议有效');
  });

  it('本地凌晨记录归入本地日，晚于区间完成或无完成日期不能算历史已完成', () => {
    const date = new Date(2026, 10, 5, 0, 30).toISOString();
    const evidence = buildReviewEvidence({ reviewType: 'daily', dates: ['2026-11-05'],
      todos: [{ ...todo, createdAt: date }, { ...todo, id: 'later', completedAt: new Date(2026, 10, 6, 1).toISOString() }, { ...todo, id: 'unknown', completedAt: undefined }],
      focusSessions: [{ id: 'f1', startedAt: date, status: 'completed', durationMinutes: 25 }],
      usageByDate: new Map([['2026-11-05', 30], ['2026-11-06', 80]]) });
    expect(evidence.daily[0].completedFocusMinutes).toBe(25);
    expect(evidence.totals.tasksCompleted).toBe(1);
    expect(evidence.coverage.usageRecordedDays).toBe(1);
  });
});
