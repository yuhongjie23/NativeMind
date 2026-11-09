import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteReviewRepository } from '@infrastructure/db/repositories/review-repository';
import { SqliteTodoRepository } from '@infrastructure/db/repositories/todo-repository';
import { NodeSqliteDriver } from '../sqlite-driver';
import type { ReviewLog, Todo } from '@application/ports';

const review: ReviewLog = { id: 'r1', reviewType: 'daily', date: '2026-11-06', content: '复盘', insights: ['阅读已完成'], nextTodos: ['回顾第三章'],
  evidence: { observations: [{ text: '阅读已完成', evidenceIds: ['task:t0'] }], suggestions: [], sources: [{ id: 'task:t0', kind: 'task', description: '原记录' }], limitations: [] },
  createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z' };
const task = (id = 't1'): Todo => ({ id, title: '回顾第三章', status: 'pending', tags: [], linkedNoteIds: [], createdAt: '2026-11-06T01:00:00Z', updatedAt: '2026-11-06T01:00:00Z' });

describe('复盘证据和建议采用（真实 SQLite）', () => {
  let db: Database;
  let reviews: SqliteReviewRepository;
  let todos: SqliteTodoRepository;
  beforeEach(async () => {
    db = new Database(new NodeSqliteDriver()); await db.migrate();
    reviews = new SqliteReviewRepository(db); todos = new SqliteTodoRepository(db);
    await reviews.save(review);
  });
  afterEach(async () => db.close());

  it('证据往返且旧记录无快照时兼容', async () => {
    expect((await reviews.findById('r1'))?.evidence).toEqual(review.evidence);
    await reviews.save({ ...review, evidence: undefined });
    expect((await reviews.findById('r1'))?.evidence).toBeUndefined();
  });
  it('重复采用不创建新任务；重生成保持复盘 ID 和旧建议关系', async () => {
    expect((await reviews.adoptSuggestion('r1', '回顾第三章', task())).created).toBe(true);
    expect((await reviews.adoptSuggestion('r1', '回顾第三章', task('t2'))).created).toBe(false);
    expect(await todos.findById('t2')).toBeNull();
    await reviews.save({ ...review, id: 'new-id', nextTodos: ['另一条建议'] });
    expect((await reviews.findByDate(review.date, 'daily'))?.id).toBe('r1');
    expect((await reviews.listFollowUps())[0].suggestion).toBe('回顾第三章');
  });
  it('完成、删除任务的状态可追踪，删除后再次采用不重建', async () => {
    await reviews.adoptSuggestion('r1', '回顾第三章', task());
    await todos.save({ ...task(), status: 'completed', completedAt: '2026-11-06T02:00:00Z' });
    expect((await reviews.listFollowUps())[0].status).toBe('completed');
    await todos.delete('t1');
    expect((await reviews.listFollowUps())[0]).toMatchObject({ status: 'deleted', todoId: undefined });
    expect((await reviews.adoptSuggestion('r1', '回顾第三章', task('t2'))).created).toBe(false);
    expect(await todos.findById('t2')).toBeNull();
  });
  it('来源写入失败时新任务一并回滚，随后可以重试', async () => {
    await db.execute("CREATE TRIGGER fail_follow_up BEFORE INSERT ON review_follow_ups BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await expect(reviews.adoptSuggestion('r1', '回顾第三章', task())).rejects.toThrow('test failure');
    expect(await todos.findById('t1')).toBeNull();
    expect(await reviews.listFollowUps()).toEqual([]);
    await db.execute('DROP TRIGGER fail_follow_up');
    expect((await reviews.adoptSuggestion('r1', '回顾第三章', task())).created).toBe(true);
  });
  it('过时建议不能采用；删除复盘不删除已创建任务', async () => {
    await expect(reviews.adoptSuggestion('r1', '旧页面建议', task())).rejects.toThrow('已变化');
    expect(await todos.findById('t1')).toBeNull();
    await reviews.adoptSuggestion('r1', '回顾第三章', task());
    await reviews.delete('r1');
    expect(await reviews.listFollowUps()).toEqual([]);
    expect(await todos.findById('t1')).not.toBeNull();
  });
});
