/**
 * 每日打卡 store
 *
 * 今日打卡先重算再读（RecordDailyCheckIn 聚合当日任务 + 专注），
 * 日历按月取成功日。数据落 SQLite（daily_checkins），持久化。
 * 任务/专注事件后自动刷新（与 application 的打卡订阅者同源，这里只负责 UI 侧拿新值）。
 */
import { create } from 'zustand';
import type { DailyCheckIn } from '@application/ports';
import { useSettingsStore } from './settings-store';
import { describeError, eventBus, useCases } from './runtime';

interface CheckInState {
  today: DailyCheckIn | null;
  /** date(YYYY-MM-DD) → 记录 */
  month: Record<string, DailyCheckIn>;
  yearMonth: string;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  refreshMonth: (yearMonth: string) => Promise<void>;
}

export const monthKeyOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const useCheckInStore = create<CheckInState>((set, get) => ({
  today: null,
  month: {},
  yearMonth: monthKeyOf(new Date()),
  loading: false,

  refresh: async () => {
    try {
      // 重算今日快照（任务/专注 → 落库）再读回；同时刷当前月日历
      const goal = useSettingsStore.getState().study.dailyGoalMinutes;
      const today = await useCases.recordDailyCheckIn.execute(undefined, goal);
      set({ today, error: undefined });
      void get().refreshMonth(get().yearMonth);
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  refreshMonth: async (yearMonth) => {
    set({ yearMonth, loading: true });
    try {
      const records = await useCases.listDailyCheckIns.execute(yearMonth);
      const month: Record<string, DailyCheckIn> = {};
      for (const record of records) month[record.date] = record;
      set({ month, loading: false, error: undefined });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },
}));

// 任务/专注变化 → UI 侧跟着刷新今日打卡与日历（application 订阅者已落库）
const refreshOnChange = (): void => {
  void useCheckInStore.getState().refresh();
};
eventBus.subscribe('TodoCompleted', refreshOnChange);
eventBus.subscribe('TodoConfirmed', refreshOnChange);
eventBus.subscribe('TodoUpdated', refreshOnChange);
eventBus.subscribe('TodoDeleted', refreshOnChange);
eventBus.subscribe('FocusSessionCompleted', refreshOnChange);
