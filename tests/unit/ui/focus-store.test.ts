/**
 * focus-store 统计选择器测试：今日 / 本周专注分钟
 *
 * 统计来自持久化 history（repositories.focus.listAll），
 * 选择器是纯函数，这里直接喂假 history 断言边界行为。
 */
import { describe, expect, it } from 'vitest';
import type { FocusSession } from '@application/ports';
import {
  selectTodayFocusMinutes,
  selectWeekFocusMinutes,
} from '@ui/stores/focus-store';

/** 与 focus-store 内联的周起点一致：周一 00:00（本地时区） */
const startOfLocalWeek = (): Date => {
  const now = new Date();
  const day = now.getDay(); // 0=周日
  const mondayOffset = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const session = (overrides: Partial<FocusSession> = {}): FocusSession => ({
  id: 'f-1',
  durationMinutes: 25,
  startedAt: new Date().toISOString(),
  status: 'completed',
  ...overrides,
});

const stateWith = (history: FocusSession[]) =>
  ({ history }) as unknown as Parameters<typeof selectTodayFocusMinutes>[0];

describe('selectTodayFocusMinutes', () => {
  it('只统计今天完成的会话，按实际时长（缺省回退计划值）', () => {
    const today = new Date().toISOString();
    const state = stateWith([
      // 今天完成，有实际时长 → 记实际
      session({ id: 'a', startedAt: today, durationMinutes: 25, actualMinutes: 12 }),
      // 今天完成，无实际时长（老数据） → 回退计划值
      session({ id: 'b', startedAt: today, durationMinutes: 25 }),
      // 今天中断 → 不计
      session({ id: 'c', startedAt: today, status: 'aborted' }),
      // 昨天完成 → 不计入今日
      session({ id: 'd', startedAt: new Date(Date.now() - DAY_MS).toISOString() }),
    ]);

    expect(selectTodayFocusMinutes(state)).toBe(12 + 25);
  });

  it('空历史返回 0', () => {
    expect(selectTodayFocusMinutes(stateWith([]))).toBe(0);
  });
});

describe('selectWeekFocusMinutes', () => {
  it('只统计本周（周一起）完成的会话', () => {
    const weekStart = startOfLocalWeek().getTime();
    const state = stateWith([
      // 本周一之后的今天，实际时长优先
      session({ id: 'a', startedAt: new Date(weekStart + HOUR_MS).toISOString(), durationMinutes: 25, actualMinutes: 18 }),
      // 本周一之后（今天），回退计划值
      session({ id: 'b', startedAt: new Date(weekStart + 2 * DAY_MS).toISOString(), durationMinutes: 25 }),
      // 上周完成 → 不计
      session({ id: 'c', startedAt: new Date(weekStart - DAY_MS).toISOString() }),
      // 本周中断 → 不计
      session({ id: 'd', startedAt: new Date(weekStart + HOUR_MS).toISOString(), status: 'aborted' }),
    ]);

    expect(selectWeekFocusMinutes(state)).toBe(18 + 25);
  });
});
