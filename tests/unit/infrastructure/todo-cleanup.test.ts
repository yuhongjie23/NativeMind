/**
 * 任务「替换为拆分」：replaceAll 事务化替换
 * 原任务被删除、新任务整批写入；替换后原任务不存在、新任务都在。
 */
import { describe, expect, it } from 'vitest';
import { InMemoryTodoRepository } from '@infrastructure/local-demo';
import type { Todo } from '@shared-types/domain';

const base = (overrides: Partial<Todo>): Todo => ({
  id: 't',
  title: '任务',
  status: 'pending',
  priority: 'medium',
  tags: [],
  linkedNoteIds: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('replaceAll', () => {
  it('替换后原任务删除、新任务整批写入', async () => {
    const repo = new InMemoryTodoRepository();
    await repo.save(base({ id: 'original', title: '原始目标' }));
    await repo.save(base({ id: 'other', title: '无关任务' }));

    await repo.replaceAll('original', [
      base({ id: 'a', title: '子任务A', sourceGoalId: 'g' }),
      base({ id: 'b', title: '子任务B', sourceGoalId: 'g' }),
    ]);

    expect(await repo.findById('original')).toBeNull();
    expect(await repo.findById('a')).not.toBeNull();
    expect(await repo.findById('b')).not.toBeNull();
    expect(await repo.findById('other')).not.toBeNull();
  });

  it('替换成空列表等于只删除原任务（全部子任务为空标题时）', async () => {
    const repo = new InMemoryTodoRepository();
    await repo.save(base({ id: 'original', title: '原始目标' }));

    await repo.replaceAll('original', []);

    expect(await repo.findById('original')).toBeNull();
  });
});
