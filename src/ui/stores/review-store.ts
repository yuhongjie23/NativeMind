/**
 * 复盘 store
 *
 * 复盘由 AI 生成，属于建议型写入，所以 generate 会触发确认弹窗。
 * 用例在用户拒绝时返回 null，这里据此提示「已取消」而不是报错。
 */
import { create } from 'zustand';
import type { ReviewLog } from '@shared-types/domain';
import { describeError, repositories, useCases } from './runtime';

interface ReviewState {
  reviews: ReviewLog[];
  generating: boolean;
  /** 上一次生成的结果说明，用于给用户反馈「生成好了」还是「你取消了」 */
  lastOutcome?: string;
  error?: string;
  refresh: () => Promise<void>;
  generateDaily: () => Promise<void>;
  generateWeekly: () => Promise<void>;
  generateMonthly: () => Promise<void>;
  deleteReview: (id: string) => Promise<void>;
  updateReview: (id: string, content: string) => Promise<void>;
}

export const useReviewStore = create<ReviewState>((set, get) => {
  const generate = async (
    action: () => Promise<ReviewLog | null | undefined>,
    label: string
  ) => {
    set({ generating: true, error: undefined, lastOutcome: undefined });
    try {
      const review = await action();
      set({
        generating: false,
        // 三态：已生成 / 用户取消 / 专注中被拦（给明确原因，不是「没反应」）
        lastOutcome:
          review === undefined
            ? `专注中不能生成${label}复盘，结束专注后再试`
            : review
              ? `${label}复盘已生成`
              : `${label}复盘已取消`,
      });
      await get().refresh();
    } catch (error) {
      set({ generating: false, error: describeError(error) });
    }
  };

  return {
    reviews: [],
    generating: false,

    refresh: async () => {
      try {
        set({ reviews: await repositories.review.listAll() });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    generateDaily: () => generate(() => useCases.generateDailyReview.execute({}), '每日'),
    generateWeekly: () => generate(() => useCases.generateWeeklyReview.execute({}), '每周'),
    generateMonthly: () => generate(() => useCases.generateMonthlyReview.execute({}), '每月'),

    deleteReview: async (id) => {
      set({ error: undefined });
      try {
        const deleted = await useCases.deleteReview.execute(id);
        if (deleted) await get().refresh();
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateReview: async (id, content) => {
      set({ error: undefined });
      try {
        await useCases.updateReview.execute(id, { content });
        await get().refresh();
      } catch (error) {
        set({ error: describeError(error) });
      }
    },
  };
});
