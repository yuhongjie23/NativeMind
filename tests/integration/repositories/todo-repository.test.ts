/**
 * TodoRepository 集成测试：真实 SQLite 上跑完整迁移 + CRUD。
 *
 * 相比 memory-driver 的语句形状桩，这里验证的是真库行为：
 * UPSERT 冲突更新、日期查询的 COALESCE 分支、批量事务。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Todo } from '@application/ports';
import { Database } from '@infrastructure/db/database';
import { SqliteTodoRepository } from '@infrastructure/db/repositories/todo-repository';
import { NodeSqliteDriver } from '../sqlite-driver';

const todo = (id: string, overrides: Partial<Todo> = {}): Todo => ({
  id,
  title: '理解 LoRA 与 QLoRA 的区别',
  status: 'pending',
  priority: 'medium',
  estimatedMinutes: 30,
  tags: ['llm'],
  linkedNoteIds: [],
  createdAt: '2026-08-02T09:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
  ...overrides,
});

describe('SqliteTodoRepository（真实 SQLite）', () => {
  let driver: NodeSqliteDriver;
  let repo: SqliteTodoRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver();
    await new Database(driver).migrate();
    repo = new SqliteTodoRepository(new Database(driver));
  });

  afterEach(async () => {
    await driver.close();
  });

  it('保存后能按 id 取回，JSON 列正确还原', async () => {
    const input = todo('todo_1', { tags: ['llm', 'fine-tuning'], linkedNoteIds: ['note_1'] });
    await repo.save(input);

    const found = await repo.findById('todo_1');
    expect(found).toMatchObject({
      title: '理解 LoRA 与 QLoRA 的区别',
      status: 'pending',
      priority: 'medium',
      tags: ['llm', 'fine-tuning'],
      linkedNoteIds: ['note_1'],
    });
  });

  it('save 是 UPSERT：重复保存更新同一行而不是新增', async () => {
    await repo.save(todo('todo_1'));
    await repo.save(todo('todo_1', { title: '改过的标题', status: 'completed' }));

    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('改过的标题');
    expect(all[0].status).toBe('completed');
  });

  it('按排期日期取当天任务，未排期的按创建日兜底', async () => {
    await repo.save(todo('scheduled', { scheduledDate: '2026-08-02' }));
    await repo.save(todo('created_today', { createdAt: '2026-08-02T12:00:00.000Z' }));
    await repo.save(todo('yesterday', { createdAt: '2026-08-01T09:00:00.000Z' }));

    const today = await repo.findByDate('2026-08-02');
    expect(today.map((t) => t.id).sort()).toEqual(['created_today', 'scheduled']);
  });

  it('批量保存在一个事务里全部落库', async () => {
    await repo.saveMany([todo('a'), todo('b'), todo('c')]);
    expect(await repo.listAll()).toHaveLength(3);
  });

  it('按状态筛选', async () => {
    await repo.save(todo('p'));
    await repo.save(todo('c', { status: 'completed' }));
    const completed = await repo.findByStatus('completed');
    expect(completed.map((t) => t.id)).toEqual(['c']);
  });
});
