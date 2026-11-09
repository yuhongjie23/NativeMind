/**
 * CreateTodoUseCase
 * 用户手动创建：直接写库。
 * AI 拆解建议：走 ConfirmationService 确认后写库。
 */
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { Todo, TodoDraft, TodoRepository, TodoStructuringPort, TodoStructuringOptions } from '../../ports';
import type { UUID } from '@shared-types/common';
import { formatLocalDate, newId, now } from '../../shared/utils';
import { filterDraftTitles, toTodo, type CreateTodoInput } from './todo-draft';
export type { CreateTodoInput } from './todo-draft';

export class CreateTodoUseCase {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly eventBus: EventBus,
    private readonly confirmation: ConfirmationService,
    private readonly structuring?: TodoStructuringPort
  ) {}

  /** 用户手动创建 */
  async execute(input: CreateTodoInput): Promise<Todo> {
    const todo = toTodo(input);
    await this.todoRepo.save(todo);

    await this.eventBus.publish({
      type: 'TodoConfirmed',
      todoIds: [todo.id],
      source: 'user_manual',
      timestamp: now(),
    });

    return todo;
  }

  /** 由自然语言目标拆解出多个 Todo，确认后写入 */
  async executeFromGoal(goal: string, scheduledDate?: string, options?: TodoStructuringOptions): Promise<Todo[]> {
    if (!this.structuring) throw new Error('未配置 TodoStructuringPort');

    options?.signal?.throwIfAborted();
    const drafts = await this.structuring.structure(goal, options);
    options?.signal?.throwIfAborted();

    // 拆不出东西必须让用户知道。
    // 这里原本静默 return []，于是模型不可用、输出不合 Schema、被降级链兜住
    // 这些情况在界面上全都表现为「点了没反应」—— 用户无法判断是在转圈还是失败了。
    // 抛错让 store 把提示显示出来，同时符合「模型不可用时转人工」的降级约定。
    if (drafts.length === 0) {
      throw new Error('没能拆出任务。可能是本地模型未就绪或返回格式不对，可在设置里检查模型状态，或直接手动添加。');
    }


    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      {
        actionType: 'create_todos',
        summary: `根据目标「${goal}」生成 ${drafts.length} 个任务`,
        payload: drafts,
      },
      async (payload) => {
        // 空标题草稿跳过（本地模型偶尔输出空字段），避免 saveMany 中途抛错
        const todos = filterDraftTitles(payload).map((draft) =>
          toTodo({ ...draft, scheduledDate })
        );
        await this.todoRepo.saveMany(todos);
        return todos;
      },
      options
    );

    if (!confirmed || !result) return [];

    await this.eventBus.publish({
      type: 'TodoConfirmed',
      todoIds: result.map((todo) => todo.id),
      source: 'ai_suggestion',
      timestamp: now(),
    });

    return result;
  }

  /** 只拆不写：返回 AI 拆出的草稿，供页面预览，用户选择「采用拆分/直接加入」后再落库 */
  async structureGoal(goal: string, options?: TodoStructuringOptions): Promise<TodoDraft[]> {
    if (!this.structuring) throw new Error('未配置 TodoStructuringPort');

    options?.signal?.throwIfAborted();
    const drafts = await this.structuring.structure(goal, options);
    options?.signal?.throwIfAborted();
    if (drafts.length === 0) {
      throw new Error('没能拆出任务。可能是本地模型未就绪或返回格式不对，可直接加入。');
    }
    return drafts;
  }

  /**
   * 用户确认拆分后写入多条 todo，共享同一个 sourceGoalId（软连接任务组，无外键）。
   * 用户在页面已明确选择，这里仍走确认门（requiresConfirmation: false 只补审计记录、
   * 不再弹第二个确认框），保证每条 AI 建议型写入都有 action_proposal 落库。
   */
  async executeDrafts(
    drafts: TodoDraft[],
    sourceGoalId?: string,
    scheduledDate?: string
  ): Promise<Todo[]> {
    const groupId = sourceGoalId ?? newId();

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      {
        actionType: 'create_todos',
        summary: `采用 AI 拆分：${drafts.length} 个任务`,
        payload: drafts,
        // 页面已确认过，这里只记审计、不弹窗
        requiresConfirmation: false,
      },
      async (payload) => {
        // 空标题草稿先过滤，避免 saveMany 中途抛错留下半批数据
        const todos = filterDraftTitles(payload).map((draft) => ({
          ...toTodo({ ...draft, scheduledDate }),
          sourceGoalId: groupId,
        }));
        await this.todoRepo.saveMany(todos);
        return todos;
      }
    );

    if (!confirmed || !result) return [];

    await this.eventBus.publish({
      type: 'TodoConfirmed',
      todoIds: result.map((todo) => todo.id),
      source: 'ai_suggestion',
      timestamp: now(),
    });

    return result;
  }

  /**
   * 替换为拆分：在一个事务里「删原任务 + 整批写入拆分任务」。
   * 任何一条失败都不会留下「原任务已删、新任务没写」的丢数据状态；
   * 空标题草稿先过滤，避免 AI 输出空字段时把替换停在半途。
   * 与 executeDrafts 一样走确认门补审计记录（页面已确认，不弹窗）。
   */
  async executeReplaceDrafts(
    originalId: UUID,
    drafts: TodoDraft[],
    sourceGoalId?: string,
    scheduledDate?: string
  ): Promise<Todo[]> {
    const original = await this.todoRepo.findById(originalId);
    if (!original || (original.status !== 'pending' && original.status !== 'in_progress')) {
      throw new Error('原任务已删除、已拆分或已结束，请刷新后再试。');
    }
    const groupId = sourceGoalId ?? original.sourceGoalId ?? newId();

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      {
        actionType: 'create_todos',
        summary: `替换为拆分：${drafts.length} 个任务`,
        payload: drafts,
        requiresConfirmation: false,
      },
      async (payload) => {
        const todos = filterDraftTitles(payload).map((draft) => ({
          ...toTodo({
            ...draft,
            description: draft.description ?? original.description,
            priority: draft.priority ?? original.priority,
            scheduledDate: scheduledDate ?? original.scheduledDate ?? formatLocalDate(new Date(original.createdAt)),
            tags: [...new Set([...original.tags, ...(draft.tags ?? [])])],
            linkedNoteIds: original.linkedNoteIds,
          }),
          sourceGoalId: groupId,
        }));
        await this.todoRepo.replaceAll(originalId, todos);
        return todos;
      }
    );

    if (!confirmed || !result) return [];

    await this.eventBus.publish({
      type: 'TodoConfirmed',
      todoIds: result.map((todo) => todo.id),
      source: 'ai_suggestion',
      timestamp: now(),
    });

    return result;
  }
}
