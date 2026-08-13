/**
 * Todo store
 *
 * 只做两件事：调用例、把结果放进 state。不含业务判断 —— 标题校验、
 * 状态流转都在用例和领域层，这里重复一遍只会两边不一致。
 */
import { create } from 'zustand';
import type { Todo } from '@shared-types/domain';
import type { TodoDraft } from '@application/ports';
import type { CreateTodoInput } from '@application/use-cases/todo/create-todo';
import type { UpdateTodoPatch } from '@application/use-cases/todo/update-todo';
import { describeError, repositories, useCases } from './runtime';

interface TodoState {
  todos: Todo[];
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  /** 立即落库并返回创建的任务（不阻塞在 AI 拆解上） */
  create: (input: CreateTodoInput) => Promise<Todo | undefined>;
  /** 自然语言目标拆解，写入前会弹确认 */
  createFromGoal: (goal: string) => Promise<void>;
  /** 只拆不写：返回草稿供页面预览（用户选择采用/直接加入） */
  structureGoal: (goal: string) => Promise<TodoDraft[]>;
  /** 采用拆分：多条 todo 共享 sourceGoalId 落库（软连接任务组） */
  createDrafts: (drafts: TodoDraft[], sourceGoalId?: string) => Promise<void>;
  /** 替换为拆分：事务化「删原任务 + 整批写拆分任务」，任一失败不丢原任务 */
  replaceWithDrafts: (originalId: string, drafts: TodoDraft[]) => Promise<void>;
  complete: (todoId: string) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<void>;
  update: (todoId: string, patch: UpdateTodoPatch) => Promise<void>;
}

export const useTodoStore = create<TodoState>((set, get) => {
  /** 用例执行完统一重读一遍：真实数据在库里，不在 store */
  const run = async (action: () => Promise<unknown>) => {
    set({ error: undefined });
    try {
      await action();
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  };

  return {
    todos: [],
    loading: false,

    refresh: async () => {
      set({ loading: true });
      try {
        set({ todos: await repositories.todo.listAll(), loading: false });
      } catch (error) {
        set({ loading: false, error: describeError(error) });
      }
    },

    create: async (input) => {
      set({ error: undefined });
      try {
        const todo = await useCases.createTodo.execute(input);
        await get().refresh();
        return todo;
      } catch (error) {
        set({ error: describeError(error) });
        return undefined;
      }
    },
    createFromGoal: (goal) => run(() => useCases.createTodo.executeFromGoal(goal)),
    structureGoal: (goal) => useCases.createTodo.structureGoal(goal),
    createDrafts: (drafts, sourceGoalId) =>
      run(() => useCases.createTodo.executeDrafts(drafts, sourceGoalId)),
    replaceWithDrafts: (originalId, drafts) =>
      run(() => useCases.createTodo.executeReplaceDrafts(originalId, drafts)),
    complete: (todoId) => run(() => useCases.completeTodo.execute(todoId)),
    deleteTodo: (todoId) => run(() => useCases.deleteTodo.execute(todoId)),
    update: (todoId, patch) => run(() => useCases.updateTodo.execute(todoId, patch)),
  };
});

/** 待办：完成和取消的都不算 */
export const selectPendingTodos = (state: TodoState): Todo[] =>
  state.todos.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled');
