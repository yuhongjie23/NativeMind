/**
 * 陪伴 agent 决策层单测
 * decide 是纯函数：卡住任务 > 里程碑 > 空闲轻招呼 > 安静。
 */
import { describe, expect, it } from 'vitest';
import { buildFacts, decide, type AgentContext } from '@ai/companion/companion-agent';

const base = (overrides: Partial<AgentContext> = {}): AgentContext => ({
  minutesSinceLastInteraction: 60,
  minutesSinceLastHealthReminder: Number.POSITIVE_INFINITY,
  healthReminderCountToday: 0,
  todayFocusMinutes: 0,
  todayCompletedTodos: 0,
  todayCompletedSessions: 0,
  overdueDays: 0,
  pendingTodoCount: 0,
  stuckEncouragedToday: false,
  milestoneCelebratedToday: false,
  ...overrides,
});

describe('decide', () => {
  it('卡住的任务优先触发鼓励（含阈值边界）', () => {
    expect(decide(base({ overdueDays: 2 }))?.sceneType).toBe('stuck_encourage');
    expect(decide(base({ overdueDays: 5, todayCompletedSessions: 3 }))?.sceneType).toBe('stuck_encourage');
    expect(decide(base({ overdueDays: 1 }))?.sceneType).not.toBe('stuck_encourage');
  });

  it('达到里程碑触发肯定', () => {
    expect(decide(base({ todayCompletedSessions: 2 }))?.sceneType).toBe('milestone_celebrate');
  });

  it('边沿触发：已发过鼓励/里程碑当天不再重复', () => {
    // 卡住但今天已鼓励过 → 不再重复，落到里程碑/健康提醒/轻招呼/安静
    expect(decide(base({ overdueDays: 3, stuckEncouragedToday: true }))?.sceneType).not.toBe('stuck_encourage');
    // 里程碑今天已肯定过 → 不再重复
    expect(decide(base({ todayCompletedSessions: 4, milestoneCelebratedToday: true }))?.sceneType).not.toBe('milestone_celebrate');
    // 都已发过但满足轻招呼条件且健康提醒已发过 → 仍可轻招呼
    expect(
      decide(base({
        overdueDays: 3,
        stuckEncouragedToday: true,
        todayCompletedSessions: 4,
        milestoneCelebratedToday: true,
        todayFocusMinutes: 25,
        minutesSinceLastHealthReminder: 5, // 刚提醒过，健康分支让位
      }))?.sceneType
    ).toBe('idle_checkin');
  });

  it('距上次互动够久且有活动 → 轻招呼（健康已提醒过时）', () => {
    const healthy = { minutesSinceLastHealthReminder: 5 }; // 健康节律未到，让位给轻招呼
    expect(decide(base({ todayFocusMinutes: 25, ...healthy }))?.sceneType).toBe('idle_checkin');
    expect(decide(base({ todayCompletedTodos: 1, ...healthy }))?.sceneType).toBe('idle_checkin');
    expect(decide(base({ pendingTodoCount: 2, ...healthy }))?.sceneType).toBe('idle_checkin');
  });

  it('距上次互动够久但健康节律到了 → 优先发健康提醒', () => {
    const reminder = decide(base({ todayFocusMinutes: 25, minutesSinceLastHealthReminder: 40 }));
    expect(reminder?.sceneType).toBe('health_reminder');
    expect(reminder?.facts).toMatch(/久坐提醒/);
  });

  it('健康提醒每 30 分钟节律：未到 30 分钟则让位', () => {
    expect(
      decide(base({ todayFocusMinutes: 25, minutesSinceLastHealthReminder: 20 }))?.sceneType
    ).toBe('idle_checkin');
  });

  it('健康提醒轮换：第 1 次眨眼、第 5 次回到眨眼（facts 带动作）', () => {
    expect(decide(base({ healthReminderCountToday: 0, minutesSinceLastHealthReminder: 40 }))?.facts).toMatch(/眨眼/);
    expect(decide(base({ healthReminderCountToday: 1, minutesSinceLastHealthReminder: 40 }))?.facts).toMatch(/扭扭腰|站起来/);
    expect(decide(base({ healthReminderCountToday: 4, minutesSinceLastHealthReminder: 40 }))?.facts).toMatch(/眨眼/);
  });

  it('健康提醒达每日上限后不再发', () => {
    expect(
      decide(base({ healthReminderCountToday: 12, minutesSinceLastHealthReminder: 40 }))
    ).toBeNull();
  });

  it('距上次互动太近 → 安静（健康提醒也安静等候）', () => {
    expect(
      decide(base({ minutesSinceLastInteraction: 5, todayFocusMinutes: 25, minutesSinceLastHealthReminder: 40 }))
    ).toBeNull();
  });

  it('完全没活动且健康刚到点 → 也发健康提醒（久坐关怀不依赖学习活动）', () => {
    expect(
      decide(base({ minutesSinceLastInteraction: 60, minutesSinceLastHealthReminder: 40 }))?.sceneType
    ).toBe('health_reminder');
  });
});

describe('buildFacts', () => {
  it('组装成一句话事实', () => {
    expect(
      buildFacts(base({ todayFocusMinutes: 50, todayCompletedTodos: 2, pendingTodoCount: 3 }))
    ).toBe('今天专注了 50 分钟，完成了 2 个任务，还有 3 个任务待做');
  });
});
