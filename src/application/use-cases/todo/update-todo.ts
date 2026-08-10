/**
 * UpdateTodoUseCase - 用户直接编辑，直接写库
 *
 * 之前完全绕过领域规则：completed 可改回 pending、完成时不写 completedAt、
 * 标题不查长度、时长不校验。这里在用例层补齐状态机与字段校验，
 * 并发布 TodoUpdated 事件让订阅者/审计感知。
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { Todo, TodoRepository, TodoStatus } from '../../ports';
import { now } from '../../shared/utils';

export type UpdateTodoPatch = Partial<
  Pick<
    Todo,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'estimatedMinutes'
    | 'scheduledDate'
    | 'tags'
    | 'linkedNoteIds'
  >
>;

/** 与 DB CHECK 一致的状态迁移规则：completed 是终态，cancelled 可重新激活 */
const ALLOWED_TRANSITIONS: Record<TodoStatus, TodoStatus[]> = {
  pending: ['in_progress', 'cancelled', 'completed'],
  in_progress: ['completed', 'cancelled', 'pending'],
  completed: [],
  cancelled: ['pending'],
};

export class UpdateTodoUseCase {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly eventBus: EventBus
  ) {}

  async execute(todoId: UUID, patch: UpdateTodoPatch): Promise<Todo> {
    const todo = await this.todoRepo.findById(todoId);
    if (!todo) throw new Error(`Todo 不存在: ${todoId}`);

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error('Todo 标题不能为空');
      if (title.length > 200) throw new Error('Todo 标题不能超过 200 字符');
    }
    if (patch.estimatedMinutes !== undefined && patch.estimatedMinutes <= 0) {
      throw new Error('估计时长必须为正数');
    }
    if (patch.status !== undefined && patch.status !== todo.status) {
      const allowed = ALLOWED_TRANSITIONS[todo.status] ?? [];
      if (!allowed.includes(patch.status)) {
        throw new Error(`不允许从 ${todo.status} 转换到 ${patch.status}`);
      }
    }

    const timestamp = now();
    const updated: Todo = {
      ...todo,
      ...patch,
      // 完成时记录完成时间；否则保持原值
      completedAt: patch.status === 'completed' ? timestamp : todo.completedAt,
      updatedAt: timestamp,
    };
    await this.todoRepo.save(updated);

    await this.eventBus.publish({
      type: 'TodoUpdated',
      todoId: updated.id,
      timestamp,
    });

    return updated;
  }
}
