/**
 * 复盘 store
 *
 * 复盘由 AI 生成，属于建议型写入，所以 generate 会触发确认弹窗。
 * 用例在用户拒绝时返回 null，这里据此提示「已取消」而不是报错。
 */
import { create } from 'zustand';
import type { ReviewLog } from '@shared-types/domain';
import type { ReviewFollowUp } from '@application/ports';
import { describeError, repositories, useCases } from './runtime';

interface ReviewState {
  reviews: ReviewLog[];
  followUps: ReviewFollowUp[];
  adopting: boolean;
  adoptSuggestion: (reviewId: string, suggestion: string) => Promise<void>;
  generating: boolean;
  canCancel: boolean;
  cancelGeneration: () => void;
  /** 上一次生成的结果说明，用于给用户反馈「生成好了」还是「你取消了」 */
  lastOutcome?: string;
  error?: string;
  refresh: () => Promise<void>;
  generateDaily: () => Promise<void>;
  generateWeekly: () => Promise<void>;
  generateMonthly: () => Promise<void>;
  generateLearning: (reminderId: string) => Promise<void>;
  deleteReview: (id: string) => Promise<void>;
  updateReview: (id: string, content: string) => Promise<void>;
}

export const useReviewStore = create<ReviewState>((set, get) => {
  let active: AbortController | undefined;
  let sequence = 0;
  const generate = async (
    action: (options: { signal: AbortSignal; onCommit: () => void }) => Promise<ReviewLog | null | undefined>,
    label: string
  ) => {
    if (get().generating) return;
    const controller = new AbortController();
    active = controller;
    const seq = ++sequence;
    set({ generating: true, canCancel: true, error: undefined, lastOutcome: undefined });
    try {
      const review = await action({ signal: controller.signal, onCommit: () => {
        if (seq === sequence) set({ canCancel: false });
      } });
      if (seq !== sequence) return;
      set({
        generating: false,
        canCancel: false,
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
      if (seq !== sequence) return;
      set({ generating: false, canCancel: false, error: describeError(error) });
    }
  };

  return {
    reviews: [],
    followUps: [],
    adopting: false,
    adoptSuggestion: async (reviewId, suggestion) => {
      if (get().adopting) return;
      set({ adopting: true, error: undefined });
      try {
        await useCases.adoptReviewSuggestion.execute(reviewId, suggestion);
        await get().refresh();
      } catch (error) {
        set({ error: describeError(error) });
      } finally {
        set({ adopting: false });
      }
    },
    generating: false,
    canCancel: false,
    cancelGeneration: () => {
      if (!get().canCancel) return;
      sequence += 1;
      active?.abort();
      set({ generating: false, canCancel: false, error: undefined, lastOutcome: '已停止生成' });
    },

    refresh: async () => {
      try {
        const [reviews, followUps] = await Promise.all([repositories.review.listAll(), repositories.review.listFollowUps()]);
        set({ reviews, followUps });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    generateDaily: () => generate((options) => useCases.generateDailyReview.execute(options), '每日'),
    generateWeekly: () => generate((options) => useCases.generateWeeklyReview.execute(options), '每周'),
    generateMonthly: () => generate((options) => useCases.generateMonthlyReview.execute(options), '每月'),
    generateLearning: reminderId => generate(options => useCases.reviewLearning!.execute(reminderId, options), '学习跟进'),

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
