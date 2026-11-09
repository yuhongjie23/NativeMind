import { afterEach, describe, expect, it, vi } from 'vitest';
import { actOnReminder, nextReminderDate } from '@domain/learning';
import { ManageRemindersUseCase, TrackKnowledgeUseCase, ReviewLearningUseCase } from '@application/use-cases/learning';
import { GenerateDailyReviewUseCase } from '@application/use-cases/review/generate-daily-review';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';
import { InMemoryLearningRepository } from '@infrastructure/learning-memory';
import { InMemorySettingsRepository, InMemoryNoteRepository, InMemoryReviewRepository, InMemoryTodoRepository, InMemoryFocusRepository, InMemoryActionProposalRepository } from '@infrastructure/local-demo';
import type { ReviewDraft, ReviewGeneratorPort } from '@application/ports';

function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T00:00:00Z'));
  const repo = new InMemoryLearningRepository();
  const settings = new InMemorySettingsRepository();
  const focus = new FocusModePolicy();
  const sync = vi.fn(async (entries: { id: string; title: string; dueAt: string }[]) => ({ supported: true, enabled: true, scheduled: entries.length, message: 'ok' }));
  const reminders = new ManageRemindersUseCase(repo, settings, { sync }, focus);
  const knowledge = new TrackKnowledgeUseCase(repo, new InMemoryNoteRepository());
  return { repo, settings, focus, sync, reminders, knowledge };
}
const input = { title: '复习二分查找', kind: 'review' as const, dueAt: '2026-11-06T01:00:00Z', repeat: 'daily' as const };
afterEach(() => vi.useRealTimers());

describe('学习提醒与持续自评', () => {
  it('错过多天只推进到下一次；延后不改变原定每日时间', async () => {
    const { reminders } = setup();
    const original = await reminders.create(input);
    const snoozed = actOnReminder(original, 'snooze', '2026-11-09T02:00:00Z', '2026-11-09T03:00:00Z');
    expect(snoozed.anchorAt).toBe(original.anchorAt);
    const done = actOnReminder(snoozed, 'complete', '2026-11-09T03:00:00Z');
    expect(done.dueAt).toBe('2026-11-10T01:00:00.000Z');
    expect(done.history.map(entry => entry.action)).toEqual(['snooze', 'complete']);
    expect(nextReminderDate(input.dueAt, 'weekly', '2026-11-24T03:00:00Z')).toBe('2026-11-27T01:00:00.000Z');
  });
  it('一次提醒跳过后结束，停止重复提醒后不能再次推进，延后拒绝过去时间', async () => {
    const { reminders } = setup();
    const one = await reminders.create({ ...input, repeat: 'once' });
    await reminders.act(one.id, 'skip', 1);
    expect((await reminders.list())[0].state).toBe('skipped');
    await expect(reminders.act(one.id, 'complete', 2)).rejects.toThrow('已经结束');
    const daily = await reminders.create(input);
    await expect(reminders.act(daily.id, 'snooze', 1, '2026-11-05T01:00:00Z')).rejects.toThrow('晚于现在');
    await expect(reminders.act(daily.id, 'snooze', 1, '2026-11-06T00:10:00Z')).rejects.toThrow('原定时间');
    await reminders.act(daily.id, 'stop', 1);
    await expect(reminders.act(daily.id, 'complete', 2)).rejects.toThrow('已经结束');
  });
  it('并发双击只有一次推进，失效页面不能覆盖新版本', async () => {
    const { reminders, repo } = setup();
    const reminder = await reminders.create(input);
    const attempts = await Promise.allSettled([reminders.act(reminder.id, 'skip', 1), reminders.act(reminder.id, 'complete', 1)]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(await repo.findReminder(reminder.id)).toMatchObject({ revision: 2, history: [expect.any(Object)] });
  });
  it('系统提醒需主动开启；专注时撤销，结束恢复，退出设置撤销所有本库计划', async () => {
    const { reminders, sync, focus } = setup();
    await reminders.create(input);
    expect(sync).toHaveBeenLastCalledWith([]);
    await reminders.setSystemEnabled(true);
    expect(sync.mock.lastCall?.[0]).toHaveLength(1);
    await reminders.sync(); expect(sync).toHaveBeenCalledTimes(2);
    focus.activate('focus'); await reminders.sync();
    expect(sync).toHaveBeenLastCalledWith([]);
    focus.deactivate(); await reminders.sync();
    expect(sync.mock.lastCall?.[0]).toHaveLength(1);
    // Crossing the deadline must not cancel the Windows toast right as it fires.
    vi.setSystemTime(new Date('2026-11-07T00:00:00Z')); await reminders.sync();
    expect(sync).toHaveBeenCalledTimes(4);
    await reminders.setSystemEnabled(false); expect(sync).toHaveBeenLastCalledWith([]);
  });
  it('系统失败不丢本地提醒，提示失败且允许重新同步', async () => {
    const { reminders, sync } = setup();
    await reminders.create(input);
    sync.mockRejectedValueOnce(new Error('Windows unavailable'));
    await reminders.setSystemEnabled(true);
    expect(reminders.status.message).toContain('同步失败');
    expect(await reminders.list()).toHaveLength(1);
    expect((await reminders.retrySync()).scheduled).toBe(1);
  });
  it('自评追加保留困难和遗忘历史，旧版本不能覆盖，完成提醒不推断掌握', async () => {
    const { knowledge, reminders } = setup();
    const first = await knowledge.record({ title: '二分查找', rating: 'difficult', difficulty: '边界', result: '遗漏' });
    const second = await knowledge.record({ id: first.id, revision: 1, title: first.title, rating: 'forgotten', difficulty: '前提', result: '未能复述' });
    await expect(knowledge.record({ id: first.id, revision: 1, title: first.title, rating: 'confident', difficulty: '', result: '' })).rejects.toThrow('已变化');
    const reminder = await reminders.create({ ...input, knowledgeId: first.id });
    await reminders.act(reminder.id, 'complete', 1);
    expect((await knowledge.list())[0]).toEqual(second);
    expect(second.observations.map(entry => entry.rating)).toEqual(['difficult', 'forgotten']);
  });
  it('无效日期、缺失关联条目不产生提醒', async () => {
    const { reminders } = setup();
    await expect(reminders.create({ ...input, dueAt: 'invalid' })).rejects.toThrow('未来');
    await expect(reminders.create({ ...input, knowledgeId: 'missing' })).rejects.toThrow('不存在');
    expect(await reminders.list()).toEqual([]);
  });
});

describe('提醒发起复盘的确认闭环', () => {
  async function fixture(confirm: boolean, snoozeDuringReview = false) {
    const state = setup();
    const todos = new InMemoryTodoRepository(); const reviews = new InMemoryReviewRepository(todos);
    const timestamp = new Date().toISOString();
    await reviews.save({ id: 'previous', reviewType: 'daily', date: '2026-11-05', content: '上次复盘', summary: '模型推断已经完全掌握', nextTodos: ['重读边界条件'], insights: [], createdAt: timestamp, updatedAt: timestamp });
    await reviews.adoptSuggestion('previous', '重读边界条件', { id: 'task', title: '重读边界条件', status: 'pending', tags: [], linkedNoteIds: [], createdAt: timestamp, updatedAt: timestamp });
    const entry = await state.knowledge.record({ title: '二分查找', rating: 'forgotten', difficulty: '边界条件', result: '合上书无法复述' });
    const reminder = await state.reminders.create({ ...input, repeat: 'once', reviewId: 'previous', knowledgeId: entry.id });
    const generate = vi.fn(async (_input: Parameters<ReviewGeneratorPort['generate']>[0]): Promise<ReviewDraft> => {
      if (snoozeDuringReview) await state.reminders.act(reminder.id, 'snooze', 1, '2026-11-06T02:00:00Z');
      return { content: '先复述边界条件', insights: [], nextTodos: [] };
    });
    const daily = new GenerateDailyReviewUseCase(reviews, todos, new InMemoryFocusRepository(), { generate },
      new ConfirmationService(new InMemoryActionProposalRepository(), async () => confirm), new SimpleEventBus(), state.focus);
    const review = new ReviewLearningUseCase(state.repo, reviews, daily, state.reminders);
    return { ...state, review, reviews, generate, reminder };
  }
  it('用户拒绝草稿不写复盘也不结束提醒；输入包含旧建议、执行状态和自评', async () => {
    const f = await fixture(false); await f.review.execute(f.reminder.id);
    const captured = f.generate.mock.calls[0][0];
    expect(captured.knowledgeSummary).toContain('重读边界条件');
    expect(captured.knowledgeSummary).toContain('forgotten');
    expect(captured.knowledgeSummary).not.toContain('模型推断已经完全掌握');
    expect(captured.followUps?.[0]).toMatchObject({ status: 'pending', suggestion: '重读边界条件' });
    expect(await f.reviews.listAll()).toHaveLength(1);
    expect(await f.repo.findReminder(f.reminder.id)).toMatchObject({ state: 'scheduled', revision: 1 });
  });
  it('确认后保存复盘并完成一次提醒', async () => {
    const f = await fixture(true); await f.review.execute(f.reminder.id);
    expect(await f.reviews.listAll()).toHaveLength(2);
    expect(await f.repo.findReminder(f.reminder.id)).toMatchObject({ state: 'completed', revision: 2 });
  });
  it('生成时另行延后不被确认完成覆盖', async () => {
    const f = await fixture(true, true); await f.review.execute(f.reminder.id);
    expect(await f.repo.findReminder(f.reminder.id)).toMatchObject({ state: 'scheduled', revision: 2, dueAt: '2026-11-06T02:00:00Z' });
  });
  it('专注中拦截生成，已删除的关联复盘不悄悄替换为另一份', async () => {
    const f = await fixture(true); f.focus.activate('focus');
    await f.review.execute(f.reminder.id); expect(f.generate).not.toHaveBeenCalled();
    expect((await f.repo.findReminder(f.reminder.id))?.state).toBe('scheduled');
    f.focus.deactivate(); await f.reviews.delete('previous');
    await expect(f.review.execute(f.reminder.id)).rejects.toThrow('已删除');
  });
});
