import { afterEach, expect, it, vi } from 'vitest';
import { UpdateTodoUseCase } from '@application/use-cases/todo/update-todo';
import { CompleteTodoUseCase } from '@application/use-cases/todo/complete-todo';
import { SimpleEventBus } from '@application/events/event-bus';
import { InMemoryTodoRepository } from '@infrastructure/local-demo';

afterEach(() => vi.useRealTimers());

it('隔天再次提交已完成状态，不篡改完成日期', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T12:00:00+08:00'));
  const repo = new InMemoryTodoRepository();
  const completedAt = '2026-11-01T12:00:00+08:00';
  await repo.save({ id: 't1', title: '阅读', status: 'completed', tags: [], linkedNoteIds: [], createdAt: completedAt, updatedAt: completedAt, completedAt });
  await new UpdateTodoUseCase(repo, new SimpleEventBus()).execute('t1', { status: 'completed', title: ' 阅读第三章 ' });
  expect(await repo.findById('t1')).toMatchObject({ completedAt, title: '阅读第三章' });
});

it('取消任务必须先恢复，完成按钮不能绕过状态规则', async () => {
  const repo = new InMemoryTodoRepository();
  await repo.save({ id: 't1', title: '阅读', status: 'cancelled', tags: [], linkedNoteIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await expect(new CompleteTodoUseCase(repo, new SimpleEventBus()).execute('t1')).rejects.toThrow();
  expect((await repo.findById('t1'))?.status).toBe('cancelled');
});
