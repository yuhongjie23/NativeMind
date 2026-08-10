/**
 * 「替换为拆分」数据安全：executeReplaceDrafts
 *
 * 之前的实现是「先硬删原任务，再整批写拆分」，AI 输出空标题时 toTodo() 抛错，
 * 原任务被删、新任务没写 —— 用户任务消失。这里用内存仓库验证修复后的行为：
 * 1. 空标题草稿被跳过，原任务被有效草稿整体替换；
 * 2. 全部草稿为空时抛错，原任务保留。
 */
import { describe, expect, it } from 'vitest';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { CreateTodoUseCase } from '@application/use-cases/todo/create-todo';
import {
  InMemoryActionProposalRepository,
  InMemoryTodoRepository,
} from '@infrastructure/local-demo';
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

const makeUseCase = (repo: InMemoryTodoRepository): CreateTodoUseCase => {
  const confirmation = new ConfirmationService(
    new InMemoryActionProposalRepository(),
    async () => true
  );
  return new CreateTodoUseCase(repo, new SimpleEventBus(), confirmation);
};

describe('executeReplaceDrafts（替换为拆分）', () => {
  it('空标题草稿被跳过，原任务被有效草稿整体替换', async () => {
    const repo = new InMemoryTodoRepository();
    await repo.save(base({ id: 'orig', title: '原始目标' }));
    await repo.save(base({ id: 'other', title: '无关任务' }));
    const uc = makeUseCase(repo);

    const result = await uc.executeReplaceDrafts('orig', [
      { title: '子任务A' },
      { title: '   ' },
      { title: '' },
    ]);

    expect(result).toHaveLength(1);
    expect(await repo.findById('orig')).toBeNull();
    expect(await repo.findById(result[0].id)).not.toBeNull();
    // 无关任务不受影响
    expect(await repo.findById('other')).not.toBeNull();
  });

  it('全部草稿为空 → 抛错且原任务保留', async () => {
    const repo = new InMemoryTodoRepository();
    await repo.save(base({ id: 'orig', title: '原始目标' }));
    const uc = makeUseCase(repo);

    await expect(
      uc.executeReplaceDrafts('orig', [{ title: '' }, { title: '  ' }])
    ).rejects.toThrow();

    // 没有发生「先删后写失败」—— 原任务还在
    expect(await repo.findById('orig')).not.toBeNull();
  });
});
