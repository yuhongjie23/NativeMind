/**
 * 陪伴 agent 决策层单测
 * decide 是纯函数：卡住任务 > 里程碑 > 空闲轻招呼 > 安静。
 */
import { describe, expect, it } from 'vitest';
import { buildFacts, decide, type AgentContext } from '@ai/companion/companion-agent';

const base = (overrides: Partial<AgentContext> = {}): AgentContext => ({
  minutesSinceLastInteraction: 60,
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
    // 卡住但今天已鼓励过 → 不再重复，落到里程碑/轻招呼/安静
    expect(decide(base({ overdueDays: 3, stuckEncouragedToday: true }))?.sceneType).not.toBe('stuck_encourage');
    // 里程碑今天已肯定过 → 不再重复
    expect(decide(base({ todayCompletedSessions: 4, milestoneCelebratedToday: true }))?.sceneType).not.toBe('milestone_celebrate');
    // 都已发过但满足轻招呼条件 → 仍可轻招呼（不打扰逻辑独立）
    expect(
      decide(base({
        overdueDays: 3,
        stuckEncouragedToday: true,
        todayCompletedSessions: 4,
        milestoneCelebratedToday: true,
        todayFocusMinutes: 25,
      }))?.sceneType
    ).toBe('idle_checkin');
  });

  it('距上次互动够久且有活动 → 轻招呼', () => {
    expect(decide(base({ todayFocusMinutes: 25 }))?.sceneType).toBe('idle_checkin');
    expect(decide(base({ todayCompletedTodos: 1 }))?.sceneType).toBe('idle_checkin');
    expect(decide(base({ pendingTodoCount: 2 }))?.sceneType).toBe('idle_checkin');
  });

  it('完全没活动 → 安静', () => {
    expect(
      decide(base({ todayFocusMinutes: 0, todayCompletedTodos: 0, pendingTodoCount: 0 }))
    ).toBeNull();
  });

  it('距上次互动太近 → 安静', () => {
    expect(decide(base({ minutesSinceLastInteraction: 5, todayFocusMinutes: 25 }))).toBeNull();
  });
});

describe('buildFacts', () => {
  it('组装成一句话事实', () => {
    expect(
      buildFacts(base({ todayFocusMinutes: 50, todayCompletedTodos: 2, pendingTodoCount: 3 }))
    ).toBe('今天专注了 50 分钟，完成了 2 个任务，还有 3 个任务待做');
  });
});
