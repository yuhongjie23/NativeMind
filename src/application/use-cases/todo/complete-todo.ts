/**
 * CompleteTodoUseCase - 用户直接操作，直接写库
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { Todo, TodoRepository } from '../../ports';
import { now } from '../../shared/utils';

export class CompleteTodoUseCase {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly eventBus: EventBus
  ) {}

  async execute(todoId: UUID): Promise<Todo> {
    const todo = await this.todoRepo.findById(todoId);
    if (!todo) throw new Error(`Todo 不存在: ${todoId}`);
    if (todo.status === 'completed') return todo;

    const completedAt = now();
    const completed: Todo = {
      ...todo,
      status: 'completed',
      completedAt,
      updatedAt: completedAt,
    };
    await this.todoRepo.save(completed);

    await this.eventBus.publish({
      type: 'TodoCompleted',
      todoId,
      completedAt,
      timestamp: completedAt,
    });

    return completed;
  }
}
