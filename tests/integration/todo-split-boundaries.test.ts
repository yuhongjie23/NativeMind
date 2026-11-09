import { afterEach, beforeEach, expect, it } from 'vitest';
import { openLearningRuntime } from './fixtures/learning-runtime';

let h: Awaited<ReturnType<typeof openLearningRuntime>>;
beforeEach(async () => { h = await openLearningRuntime(':memory:'); });
afterEach(async () => h.db.close());

it('旧拆分再次执行不产生第二批，既有专注分钟保留', async () => {
  const original = await h.create.execute({ title: '阅读再复习', scheduledDate: '2026-11-05' });
  await h.focus.save({ id: 'f1', todoId: original.id, durationMinutes: 25, actualMinutes: 20, status: 'completed', startedAt: '2026-11-05T10:00:00+08:00' });
  const drafts = [{ title: '阅读' }, { title: '复习' }];
  const saved = await h.create.executeReplaceDrafts(original.id, drafts);
  await expect(h.create.executeReplaceDrafts(original.id, drafts)).rejects.toThrow('原任务');
  expect(await h.todos.listAll()).toHaveLength(2);
  expect(saved.every(todo => todo.scheduledDate === '2026-11-05')).toBe(true);
  expect((await h.focus.findById('f1'))?.actualMinutes).toBe(20);
});

it('第二个子任务写入失败，原任务和专注关联一起回滚', async () => {
  const original = await h.create.execute({ title: '原目标' });
  await h.focus.save({ id: 'f1', todoId: original.id, durationMinutes: 25, status: 'completed', startedAt: new Date().toISOString() });
  await h.db.execute("CREATE TRIGGER fail_split BEFORE INSERT ON todos WHEN NEW.title = '触发失败' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  await expect(h.create.executeReplaceDrafts(original.id, [{ title: '第一项' }, { title: '触发失败' }])).rejects.toThrow('synthetic failure');
  expect((await h.todos.listAll()).map(todo => todo.id)).toEqual([original.id]);
  expect((await h.focus.findById('f1'))?.todoId).toBe(original.id);
  await h.db.execute('DROP TRIGGER fail_split');
  expect(await h.create.executeReplaceDrafts(original.id, [{ title: '第一项' }])).toHaveLength(1);
});

it('仓储事务内也阻止缺失、已结束原任务以及空批次', async () => {
  const original = await h.create.execute({ title: '原目标' });
  await h.complete.execute(original.id);
  const child = { ...original, id: 'new-id', title: '子任务' };
  await expect(h.todos.replaceAll(original.id, [child])).rejects.toThrow('原任务');
  await expect(h.todos.replaceAll('missing', [child])).rejects.toThrow('原任务');
  await expect(h.todos.replaceAll(original.id, [])).rejects.toThrow('不能为空');
  expect(await h.todos.findById('new-id')).toBeNull();
  expect((await h.todos.findById(original.id))?.status).toBe('completed');
});
