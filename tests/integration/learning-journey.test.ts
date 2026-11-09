import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openLearningRuntime } from './fixtures/learning-runtime';

let directory: string;
let path: string;
let h: Awaited<ReturnType<typeof openLearningRuntime>>;
let approve = true;
const day = (number: number, hour = 10, minute = 0) => vi.setSystemTime(new Date(2026, 10, number, hour, minute));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); day(1);
  directory = mkdtempSync(join(tmpdir(), 'nativemind-journey-'));
  path = join(directory, 'test.sqlite');
  approve = true;
  h = await openLearningRuntime(path, async () => approve);
});
afterEach(async () => {
  await h.db.close();
  unlinkSync(path); rmdirSync(directory); vi.useRealTimers();
});
const restart = async () => { await h.db.close(); h = await openLearningRuntime(path, async () => approve); };

it('七日学习：拒绝草稿、专注静默、采用建议、隔日完成、空白日和重启后周/月复盘', async () => {
  approve = false;
  expect(await h.create.executeFromGoal('阅读并整理排序算法')).toEqual([]);
  expect(await h.todos.listAll()).toEqual([]);
  approve = true;
  const tasks = await h.create.executeFromGoal('阅读并整理排序算法');
  const session = await h.startFocus.execute({ todoId: tasks[0].id, durationMinutes: 25 });
  expect(await h.daily.execute()).toBeUndefined();
  expect(h.inputs).toHaveLength(0);
  day(1, 10, 25);
  await h.completeFocus.execute(session.id);
  await h.complete.execute(tasks[0].id);
  const first = (await h.daily.execute())!;
  expect(first.statistics).toMatchObject({ tasksTotal: 2, tasksCompleted: 1, focusMinutes: 25 });
  expect(first.nextTodos).toHaveLength(1);
  const firstSnapshot = structuredClone(first.evidence);

  day(2); await restart();
  expect((await h.reviews.findById(first.id))?.evidence).toEqual(firstSnapshot);
  const adopted = await h.adopt.execute(first.id, first.nextTodos[0]);
  const repeated = await h.adopt.execute(first.id, first.nextTodos[0]);
  expect(repeated.todoId).toBe(adopted.todoId);
  expect(await h.todos.listAll()).toHaveLength(3);
  const second = (await h.daily.execute())!;
  expect(second.nextTodos).toEqual([]);
  expect(h.inputs.at(-1)?.followUps?.[0].status).toBe('pending');
  const aborted = await h.startFocus.execute({ todoId: adopted.todoId });
  day(2, 10, 5); await h.abortFocus.execute(aborted.id, '合成测试：临时有事');
  expect((await h.daily.execute())?.statistics?.focusMinutes).toBe(0);

  day(3); await restart();
  const finished = await h.complete.execute(adopted.todoId!);
  expect((await h.reviews.listFollowUps())[0].status).toBe('completed');
  day(4); await h.update.execute(finished.id, { status: 'completed' });
  expect((await h.todos.findById(finished.id))?.completedAt).toBe(finished.completedAt);
  const historical = (await h.daily.execute({ date: '2026-11-02' }))!;
  expect(historical.id).toBe(second.id);
  expect(historical.statistics?.tasksCompleted).toBe(0);
  expect(h.inputs.at(-1)?.followUps).toEqual([]);
  expect((await h.daily.execute())?.nextTodos).toEqual([]);
  day(5); const more = await h.create.execute({ title: '复习排序复杂度' });
  const focus = await h.startFocus.execute({ todoId: more.id, durationMinutes: 15 });
  day(5, 10, 15); await h.completeFocus.execute(focus.id); await h.complete.execute(more.id);
  day(6); expect((await h.daily.execute())?.statistics?.tasksTotal).toBe(0);
  day(7); await restart();
  const weekly = (await h.weekly.execute())!;
  expect(weekly.statistics).toMatchObject({ tasksTotal: 4, tasksCompleted: 3, focusMinutes: 40, daysCovered: 7 });
  const monthly = (await h.monthly.execute())!;
  expect(monthly.statistics).toMatchObject({ tasksTotal: 4, tasksCompleted: 3, focusMinutes: 40 });
  expect((await h.reviews.findById(first.id))?.evidence).toEqual(firstSnapshot);
  expect((await h.proposals.listPending()).length).toBe(0);
});

it('午夜跨日专注归开始日，重复完成不重复记时', async () => {
  day(1, 23, 50);
  const task = await h.create.execute({ title: '跨日阅读' });
  const session = await h.startFocus.execute({ todoId: task.id, durationMinutes: 25 });
  day(2, 0, 15);
  await h.completeFocus.execute(session.id);
  day(2, 0, 20); await h.completeFocus.execute(session.id);
  expect((await h.daily.execute({ date: '2026-11-01' }))?.statistics?.focusMinutes).toBe(25);
  expect((await h.daily.execute())?.statistics?.focusMinutes).toBe(0);
});

it('取消确认不落业务记录；崩溃遗留复盘重启后只恢复一次', async () => {
  const controller = new AbortController();
  const cancelRuntime = await openLearningRuntime(':memory:', async () => { controller.abort(); return true; });
  try {
    await expect(cancelRuntime.daily.execute({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await cancelRuntime.reviews.listAll()).toEqual([]);
    expect(await cancelRuntime.proposals.listPending()).toEqual([]);
  } finally { await cancelRuntime.db.close(); }
  const proposal = await h.confirmation.propose({ actionType: 'generate_review', summary: '合成崩溃恢复', payload: {
    date: '2026-11-01', reviewType: 'daily', content: '尚未确认的复盘', insights: [], nextTodos: [],
  } });
  expect(await h.reviews.findByDate('2026-11-01', 'daily')).toBeNull();
  await restart();
  expect(await h.recover.execute()).toBe(1);
  expect((await h.reviews.findByDate('2026-11-01', 'daily'))?.sourceProposalId).toBe(proposal.id);
  expect(await h.recover.execute()).toBe(0);
  expect(await h.reviews.listAll()).toHaveLength(1);
});
