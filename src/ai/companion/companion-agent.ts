/**
 * 陪伴 agent 决策层
 *
 * 「何时说」用确定性规则（便宜、可测、不烧模型）；「说什么」交给 InteractionGenerator
 * 用 1.5B 小模型生成。保持陪伴安静哲学：主动互动保守，专注中由 InteractionPolicy 拦截。
 */

export type AgentSceneType =
  | 'idle_checkin'
  | 'stuck_encourage'
  | 'milestone_celebrate'
  | 'health_reminder';

/** 健康提醒轮换类型（久坐关怀，每 30 分钟一轮，循环 4 种） */
export type HealthReminderKind = 'blink' | 'stretch' | 'drink_water' | 'look_far';

export const HEALTH_REMINDER_KINDS: HealthReminderKind[] = [
  'blink',
  'stretch',
  'drink_water',
  'look_far',
];

/** 玩家活动快照，由 proactive-tick 从仓储聚合 */
export interface AgentContext {
  /** 距上次宠物互动多少分钟（无互动为 Infinity） */
  minutesSinceLastInteraction: number;
  /** 距上次健康提醒多少分钟（无记录为 Infinity） */
  minutesSinceLastHealthReminder: number;
  /** 今天已发过的健康提醒次数（决定下一轮类型） */
  healthReminderCountToday: number;
  todayFocusMinutes: number;
  todayCompletedTodos: number;
  todayCompletedSessions: number;
  /** 卡住的待办已超期天数（0 = 没有） */
  overdueDays: number;
  pendingTodoCount: number;
  /** 今天是否已经为「卡住的任务」发过鼓励（边沿触发：只发一次） */
  stuckEncouragedToday: boolean;
  /** 今天是否已经为「里程碑完成」发过肯定（边沿触发：只发一次） */
  milestoneCelebratedToday: boolean;
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
  /** 距上次健康提醒超过这个分钟数才再次提醒（默认 30） */
  healthReminderIntervalMinutes: number;
  /** 距上次任意互动至少多少分钟才发健康提醒（避免紧跟闲聊/提问，默认 10） */
  healthReminderQuietAfterMinutes: number;
  /** 每小时健康提醒上限（配合 interval 防刷屏，默认 12 ≈ 6 小时工作制） */
  healthReminderDailyCap: number;
}

export const defaultAgentThresholds: AgentThresholds = {
  idleAfterMinutes: 30,
  overdueDays: 2,
  milestoneSessions: 2,
  healthReminderIntervalMinutes: 30,
  healthReminderQuietAfterMinutes: 10,
  healthReminderDailyCap: 12,
};

/** 组装 prompt 用的一句话事实 */
export const buildFacts = (ctx: AgentContext): string => {
  const parts: string[] = [];
  if (ctx.todayFocusMinutes > 0) parts.push(`今天专注了 ${ctx.todayFocusMinutes} 分钟`);
  if (ctx.todayCompletedTodos > 0) parts.push(`完成了 ${ctx.todayCompletedTodos} 个任务`);
  if (ctx.pendingTodoCount > 0) parts.push(`还有 ${ctx.pendingTodoCount} 个任务待做`);
  return parts.join('，');
};

/** 按今日已发次数轮换选择健康提醒类型（0/4/8/… → 眨眼，1/5/9 → 伸展……） */
export const healthKindFor = (countToday: number): HealthReminderKind =>
  HEALTH_REMINDER_KINDS[countToday % HEALTH_REMINDER_KINDS.length];

/** 健康提醒类型 → 一句话事实（注入 prompt，让模型说出现成动作） */
export const buildHealthFact = (kind: HealthReminderKind): string => {
  switch (kind) {
    case 'blink':
      return '久坐提醒：请眨眼几次，湿润眼睛';
    case 'stretch':
      return '久坐提醒：请站起来扭扭腰、伸个懒腰';
    case 'drink_water':
      return '久坐提醒：请喝口水，补充水分';
    case 'look_far':
      return '久坐提醒：请看向远处 20 秒，让眼睛休息';
  }
};

/**
 * 决策：要不要说、说什么。
 *
 * 边沿触发（P1 Agent）：条件「首次达到」才说话，而不是持续为真就每隔 30 分钟重复——
 * 卡住的任务只提醒一次（stuckEncouragedToday），里程碑只肯定一次（milestoneCelebratedToday），
 * 之后当天不再重复。idle_checkin 仍受距上次互动时间约束（不打扰）。
 */
export function decide(ctx: AgentContext, thresholds = defaultAgentThresholds): AgentIntent | null {
  // 卡住的任务：达到阈值且今天还没鼓励过 → 触发一次（跨天后再看是否仍卡住）
  if (ctx.overdueDays >= thresholds.overdueDays && !ctx.stuckEncouragedToday) {
    return { sceneType: 'stuck_encourage', facts: `有个任务卡了 ${ctx.overdueDays} 天` };
  }

  // 里程碑：今天专注次数跨过阈值且还没肯定过 → 触发一次
  if (
    ctx.todayCompletedSessions >= thresholds.milestoneSessions &&
    !ctx.milestoneCelebratedToday
  ) {
    return {
      sceneType: 'milestone_celebrate',
      facts: `今天已完成 ${ctx.todayCompletedSessions} 次专注`,
    };
  }

  // 健康提醒：每 30 分钟一轮，久坐关怀优先级高于闲时问候但不打扰卡任务/里程碑；
  // 且距上次任意互动至少 10 分钟（刚聊完天就提醒很突兀）
  if (
    ctx.minutesSinceLastHealthReminder >= thresholds.healthReminderIntervalMinutes &&
    ctx.minutesSinceLastInteraction >= thresholds.healthReminderQuietAfterMinutes &&
    ctx.healthReminderCountToday < thresholds.healthReminderDailyCap
  ) {
    const kind = healthKindFor(ctx.healthReminderCountToday);
    return { sceneType: 'health_reminder', facts: buildHealthFact(kind) };
  }

  const hasActivity =
    ctx.todayFocusMinutes > 0 || ctx.todayCompletedTodos > 0 || ctx.pendingTodoCount > 0;
  if (ctx.minutesSinceLastInteraction >= thresholds.idleAfterMinutes && hasActivity) {
    return { sceneType: 'idle_checkin', facts: buildFacts(ctx) };
  }

  return null;
}
