/**
 * 专注 store
 *
 * 倒计时刻意不存 state 里逐秒 setState —— 只存 startedAt 和时长，
 * 由 useFocusMode 每秒重算剩余秒数。这样切后台再回来、或者 tick 被浏览器
 * 节流，剩余时间依然是对的（按墙上时钟算，不按累加次数算）。
 */
import { create } from 'zustand';
import type { FocusSession } from '@shared-types/domain';
import { isSameLocalDay } from '@application/shared/utils';
import { describeError, repositories, useCases } from './runtime';
import { useFocusMusicStore } from './focus-music';

interface FocusState {
  active: FocusSession | null;
  history: FocusSession[];
  /** 暂停：当前暂停开始时刻（null = 未暂停）。会话级、不落库，重启后暂停态丢失。 */
  pausedAt: string | null;
  /** 已累计的暂停秒数（每次「恢复」时累加一段） */
  pausedSeconds: number;
  error?: string;
  refresh: () => Promise<void>;
  start: (input?: { todoId?: string; durationMinutes?: number }) => Promise<void>;
  complete: (notes?: string) => Promise<void>;
  abort: (reason?: string) => Promise<void>;
  /** 暂停当前专注（倒计时冻结） */
  pause: () => void;
  /** 恢复当前专注 */
  resume: () => void;
}

export const useFocusStore = create<FocusState>((set, get) => {
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
    active: null,
    history: [],
    pausedAt: null,
    pausedSeconds: 0,

    refresh: async () => {
      try {
        const [active, history] = await Promise.all([
          repositories.focus.findActive(),
          repositories.focus.listAll(),
        ]);
        set((state) => ({
          active,
          history,
          // 会话变化（新开始 / 结束 / 切会话）→ 清掉暂停态
          ...(active?.id !== state.active?.id ? { pausedAt: null, pausedSeconds: 0 } : {}),
        }));
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    start: (input = {}) => run(() => useCases.startFocus.execute(input)),

    complete: (notes) =>
      run(async () => {
        const { active } = get();
        if (!active) return;
        await useCases.completeFocus.execute(active.id, notes);
      }),

    abort: (reason) =>
      run(async () => {
        const { active } = get();
        if (!active) return;
        await useCases.abortFocus.execute(active.id, reason);
        // 专注中断：专注音乐随之停止（不保留待恢复）
        useFocusMusicStore.getState().stop();
      }),

    pause: () => {
      const { active, pausedAt } = get();
      if (!active || pausedAt) return;
      set({ pausedAt: new Date().toISOString() });
      // 暂停专注：专注音乐同步暂停（保留文件，恢复后接着播）
      useFocusMusicStore.getState().pause();
    },

    resume: () => {
      const { active, pausedAt, pausedSeconds } = get();
      if (!active || !pausedAt) return;
      const extra = Math.max(0, (Date.now() - new Date(pausedAt).getTime()) / 1000);
      set({ pausedAt: null, pausedSeconds: pausedSeconds + extra });
      // 恢复专注：专注音乐同步恢复
      void useFocusMusicStore.getState().play();
    },
  };
});

/** 实际专注分钟：提前结束按真实时长记，缺省回退计划值 */
const focusMinutes = (s: FocusSession): number => s.actualMinutes ?? s.durationMinutes;

/** 本周一 00:00（本地时区），「本周」从周一起算 */
const startOfLocalWeek = (): Date => {
  const now = new Date();
  const day = now.getDay(); // 0=周日
  const mondayOffset = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

/** 今天完成的专注分钟数，复盘页和今日页都要用 */
export const selectTodayFocusMinutes = (state: FocusState): number =>
  state.history
    .filter((s) => s.status === 'completed' && isSameLocalDay(s.startedAt))
    .reduce((sum, s) => sum + focusMinutes(s), 0);

/** 本周（周一起）完成的专注分钟数，同样来自持久化 history */
export const selectWeekFocusMinutes = (state: FocusState): number => {
  const weekStart = startOfLocalWeek().getTime();
  return state.history
    .filter((s) => s.status === 'completed' && new Date(s.startedAt).getTime() >= weekStart)
    .reduce((sum, s) => sum + focusMinutes(s), 0);
};
