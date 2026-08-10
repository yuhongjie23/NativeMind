/**
 * 陪伴 agent 决策层
 *
 * 「何时说」用确定性规则（便宜、可测、不烧模型）；「说什么」交给 InteractionGenerator
 * 用 1.5B 小模型生成。保持陪伴安静哲学：主动互动保守，专注中由 InteractionPolicy 拦截。
 */

export type AgentSceneType = 'idle_checkin' | 'stuck_encourage' | 'milestone_celebrate';

/** 玩家活动快照，由 proactive-tick 从仓储聚合 */
export interface AgentContext {
  /** 距上次宠物互动多少分钟（无互动为 Infinity） */
  minutesSinceLastInteraction: number;
  todayFocusMinutes: number;
  todayCompletedTodos: number;
  todayCompletedSessions: number;
  /** 卡住的待办已超期天数（0 = 没有） */
  overdueDays: number;
  pendingTodoCount: number;
}

export interface AgentIntent {
  sceneType: AgentSceneType;
  /** 注入 prompt 的一句话事实 */
  facts?: string;
}

export interface AgentThresholds {
  /** 距上次互动超过这个分钟数才考虑轻招呼 */
  idleAfterMinutes: number;
  /** 待办卡住多少天触发鼓励 */
  overdueDays: number;
  /** 今天完成专注达到几次触发肯定 */
  milestoneSessions: number;
}

export const defaultAgentThresholds: AgentThresholds = {
  idleAfterMinutes: 30,
  overdueDays: 2,
  milestoneSessions: 2,
};

/** 组装 prompt 用的一句话事实 */
export const buildFacts = (ctx: AgentContext): string => {
  const parts: string[] = [];
  if (ctx.todayFocusMinutes > 0) parts.push(`今天专注了 ${ctx.todayFocusMinutes} 分钟`);
  if (ctx.todayCompletedTodos > 0) parts.push(`完成了 ${ctx.todayCompletedTodos} 个任务`);
  if (ctx.pendingTodoCount > 0) parts.push(`还有 ${ctx.pendingTodoCount} 个任务待做`);
  return parts.join('，');
};

/**
 * 决策：要不要说、说什么。
 * 优先级：卡住的任务 > 里程碑肯定 > 空闲轻招呼 > 安静。
 */
export function decide(ctx: AgentContext, thresholds = defaultAgentThresholds): AgentIntent | null {
  if (ctx.overdueDays >= thresholds.overdueDays) {
    return { sceneType: 'stuck_encourage', facts: `有个任务卡了 ${ctx.overdueDays} 天` };
  }

  if (ctx.todayCompletedSessions >= thresholds.milestoneSessions) {
    return {
      sceneType: 'milestone_celebrate',
      facts: `今天已完成 ${ctx.todayCompletedSessions} 次专注`,
    };
  }

  const hasActivity =
    ctx.todayFocusMinutes > 0 || ctx.todayCompletedTodos > 0 || ctx.pendingTodoCount > 0;
  if (ctx.minutesSinceLastInteraction >= thresholds.idleAfterMinutes && hasActivity) {
    return { sceneType: 'idle_checkin', facts: buildFacts(ctx) };
  }

  return null;
}
