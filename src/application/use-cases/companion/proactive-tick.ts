/**
 * ProactiveCompanionTickUseCase - 陪伴 agent 主动调度的一拍
 *
 * 聚合玩家近期活动 → 规则决策（decide）→ 政策裁决（专注中/节流）→
 * 1.5B 生成一句台词 → 写库。返回 null 表示「这次保持安静」，不是错误。
 */
import type {
  CompanionInteraction,
  CompanionInteractionRepository,
  CompanionQuestionPort,
  FocusRepository,
  Todo,
  TodoRepository,
} from '../../ports';
import type { InteractionPolicy } from '../../policies/interaction-policy';
import { minutesSince, newId, now, today } from '../../shared/utils';
import { decide, type AgentContext } from '@ai/companion/companion-agent';

/** 卡住的待办：距今最久的那个 pending 已经多少天 */
const maxOverdueDays = (todos: Todo[]): number =>
  todos.reduce((max, todo) => {
    const days = Math.floor((Date.now() - new Date(todo.createdAt).getTime()) / 86_400_000);
    return Math.max(max, days);
  }, 0);

export class ProactiveCompanionTickUseCase {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly focusRepo: FocusRepository,
    private readonly interactionRepo: CompanionInteractionRepository,
    private readonly interactionPolicy: InteractionPolicy,
    private readonly questionPort: CompanionQuestionPort
  ) {}

  async execute(): Promise<CompanionInteraction | null> {
    const date = today();
    const [todos, focusSessions, lastInteraction, pendingTodos] = await Promise.all([
      this.todoRepo.findByDate(date),
      this.focusRepo.findByDate(date),
      this.interactionRepo.findLast(),
      this.todoRepo.findByStatus('pending'),
    ]);

    const completedSessions = focusSessions.filter((session) => session.status === 'completed');
    const context: AgentContext = {
      minutesSinceLastInteraction: lastInteraction
        ? minutesSince(lastInteraction.createdAt)
        : Number.POSITIVE_INFINITY,
      todayFocusMinutes: completedSessions.reduce((sum, session) => sum + (session.actualMinutes ?? session.durationMinutes), 0),
      todayCompletedTodos: todos.filter((todo) => todo.status === 'completed').length,
      todayCompletedSessions: completedSessions.length,
      overdueDays: maxOverdueDays(pendingTodos),
      pendingTodoCount: pendingTodos.length,
    };

    const intent = decide(context);
    if (!intent) return null;

    // 政策裁决：专注中一律不打扰、距上次互动够久、该场景今日未超上限
    if (!(await this.interactionPolicy.allowProactiveInitiation(intent.sceneType))) return null;

    const content = await this.questionPort.generateDialogue({
      scene: intent.sceneType,
      facts: intent.facts,
    });

    return this.interactionRepo.create({
      id: newId(),
      companionId: 'fulilian',
      sceneType: intent.sceneType,
      interactionType: 'dialogue',
      content,
      requiresResponse: false,
      createdAt: now(),
    });
  }
}
