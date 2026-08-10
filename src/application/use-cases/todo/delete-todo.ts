/**
 * DeleteTodoUseCase - 删除任务
 * 用户主动删除（即用户自己的确认），直接写库，并发布 TodoDeleted 事件。
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { TodoRepository } from '../../ports';
import { now } from '../../shared/utils';

export class DeleteTodoUseCase {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly eventBus: EventBus
  ) {}

  async execute(todoId: UUID): Promise<void> {
    await this.todoRepo.delete(todoId);

    await this.eventBus.publish({
      type: 'TodoDeleted',
      todoId,
      timestamp: now(),
    });
  }
}
