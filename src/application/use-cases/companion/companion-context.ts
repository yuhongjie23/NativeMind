/**
 * CompanionContextBuilder - 宠物对话上下文构建（P1-5）
 *
 * 用户点击宠物时，模型应该知道「现在几点、今天专注多久、最近在做什么、上一轮聊了什么」，
 * 而不是只看到「用户点了宠物」然后随机说「吃饭了吗」。
 *
 * 原则：只传任务标题与统计，不传笔记正文。所有字段由程序从仓库读取，
 * 模型只把这些事实组织成一句自然的话。
 */
import type {
  CompanionInteractionRepository,
  FocusRepository,
  TodoRepository,
} from '../../ports';
import { today } from '../../shared/utils';

export interface CompanionContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'late_night';
  activeFocus?: {
    todoTitle?: string;
    elapsedMinutes: number;
  };
  lastCompletedFocus?: {
    todoTitle?: string;
    actualMinutes: number;
  };
  today: {
    focusMinutes: number;
    completedTodos: number;
    pendingTodos: number;
  };
  currentTodo?: {
    title: string;
    status: string;
  };
  recentTurns: Array<{
    pet: string;
    user?: string;
  }>;
  recentLines: string[];
}

/** 本地时段推断：0-6 凌晨 / 6-12 上午 / 12-18 下午 / 18-24 晚上 */
export const timeOfDayFor = (date: Date): CompanionContext['timeOfDay'] => {
  const hour = date.getHours();
  if (hour >= 0 && hour < 6) return 'late_night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

export class CompanionContextBuilder {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly focusRepo: FocusRepository,
    private readonly interactionRepo: CompanionInteractionRepository
  ) {}

  /**
   * 构建当前上下文。
   * @param opts.activeFocus 进行中的专注（由调用方传入，因为 active 会话是内存态）
   */
  async build(opts?: {
    activeFocus?: { todoId?: string; elapsedMinutes: number };
  }): Promise<CompanionContext> {
    const date = today();
    const [todos, focusSessions, recentInteractions] = await Promise.all([
      this.todoRepo.findByDate(date),
      this.focusRepo.findByDate(date),
      this.interactionRepo.listRecent(8),
    ]);

    const completedSessions = focusSessions.filter((s) => s.status === 'completed');
    const pendingTodos = todos.filter(
      (todo) => todo.status !== 'completed' && todo.status !== 'cancelled'
    );

    // 最近一次完成的专注（用于 lastCompletedFocus）
    const lastCompleted = completedSessions[0]; // findByDate 按时间倒序
    const lastCompletedTodo = lastCompleted?.todoId
      ? todos.find((todo) => todo.id === lastCompleted.todoId)
      : undefined;

    // 当前进行中的任务：第一个 pending todo
    const currentTodo = pendingTodos[0];

    // 最近轮次：倒序取 recentInteractions，还原为正向的 pet/user 交替
    const recentTurns: CompanionContext['recentTurns'] = [];
    const recentLines: string[] = [];
    for (const interaction of [...recentInteractions].reverse()) {
      if (interaction.content && interaction.content.trim()) {
        recentLines.push(interaction.content.trim());
      }
      if (interaction.interactionType === 'question' || interaction.sceneType === 'feedback') {
        recentTurns.push({
          pet: interaction.content ?? '',
          user: interaction.userResponse,
        });
      }
    }
    const lastTurns = recentTurns.slice(-3); // 桌宠对话限制 2-3 轮

    // 今日统计
    const todayStats = {
      focusMinutes: completedSessions.reduce(
        (sum, session) => sum + (session.actualMinutes ?? session.durationMinutes),
        0
      ),
      completedTodos: todos.filter((todo) => todo.status === 'completed').length,
      pendingTodos: pendingTodos.length,
    };

    // activeFocus：传入的内存态专注会话
    let activeFocus: CompanionContext['activeFocus'];
    if (opts?.activeFocus) {
      const activeTodo = opts.activeFocus.todoId
        ? todos.find((todo) => todo.id === opts.activeFocus?.todoId)
        : undefined;
      activeFocus = {
        todoTitle: activeTodo?.title,
        elapsedMinutes: opts.activeFocus.elapsedMinutes,
      };
    }

    return {
      timeOfDay: timeOfDayFor(new Date()),
      activeFocus,
      lastCompletedFocus: lastCompleted
        ? {
            todoTitle: lastCompletedTodo?.title,
            actualMinutes: lastCompleted.actualMinutes ?? lastCompleted.durationMinutes,
          }
        : undefined,
      today: todayStats,
      currentTodo: currentTodo
        ? { title: currentTodo.title, status: currentTodo.status }
        : undefined,
      recentTurns: lastTurns,
      recentLines: recentLines.slice(-5),
    };
  }
}

/** 上下文 → 模型可读的事实文本（只含标题与统计，无笔记正文） */
export const contextToFacts = (context: CompanionContext): string => {
  const parts: string[] = [];
  parts.push(`现在是${context.timeOfDay === 'late_night' ? '深夜' : context.timeOfDay === 'morning' ? '上午' : context.timeOfDay === 'afternoon' ? '下午' : '晚上'}`);

  if (context.activeFocus) {
    parts.push(
      `正在专注中${context.activeFocus.todoTitle ? `（任务：${context.activeFocus.todoTitle}）` : ''}，已 ${context.activeFocus.elapsedMinutes} 分钟`
    );
  }
  if (context.lastCompletedFocus) {
    parts.push(
      `刚完成一段 ${context.lastCompletedFocus.actualMinutes} 分钟的专注${context.lastCompletedFocus.todoTitle ? `（任务：${context.lastCompletedFocus.todoTitle}）` : ''}`
    );
  }
  if (context.today.focusMinutes > 0) {
    parts.push(`今天已专注 ${context.today.focusMinutes} 分钟`);
  }
  if (context.today.pendingTodos > 0) {
    parts.push(
      `今天 ${context.today.completedTodos}/${context.today.completedTodos + context.today.pendingTodos} 个任务完成，还有 ${context.today.pendingTodos} 个待办`
    );
  }
  if (context.currentTodo) {
    parts.push(`当前任务：${context.currentTodo.title}`);
  }
  if (context.recentTurns.length > 0) {
    const lastTurn = context.recentTurns[context.recentTurns.length - 1];
    if (lastTurn.pet) parts.push(`上一句我说过：${lastTurn.pet}`);
    if (lastTurn.user) parts.push(`你刚才说：${lastTurn.user}`);
  }

  return parts.join('；');
};

/** 最近的台词（模型避免复述用） */
export const contextRecentLines = (context: CompanionContext): string[] => context.recentLines;
