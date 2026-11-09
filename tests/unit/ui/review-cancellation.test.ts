import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewLog } from '@shared-types/domain';

const mocks = vi.hoisted(() => ({ daily: vi.fn(), weekly: vi.fn(), monthly: vi.fn(), list: vi.fn(async () => []) }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { generateDailyReview: { execute: mocks.daily }, generateWeeklyReview: { execute: mocks.weekly }, generateMonthlyReview: { execute: mocks.monthly } },
  repositories: { review: { listAll: mocks.list, listFollowUps: async () => [] } }, describeError: String,
}));
import { useReviewStore } from '../../../src/ui/stores/review-store';

describe('review generation controls', () => {
  beforeEach(() => { useReviewStore.getState().cancelGeneration(); useReviewStore.setState({ generating: false, canCancel: false }); vi.clearAllMocks(); });
  it('ignores a stopped run completing after a new run starts', async () => {
    let finishA: ((result: ReviewLog | null) => void) | undefined;
    let finishB: ((result: ReviewLog | null) => void) | undefined;
    let signal: AbortSignal | undefined;
    mocks.daily.mockImplementation(options => { signal = options.signal; return new Promise(resolve => { finishA = resolve; }); });
    mocks.weekly.mockImplementation(() => new Promise(resolve => { finishB = resolve; }));
    const a = useReviewStore.getState().generateDaily();
    useReviewStore.getState().cancelGeneration();
    expect(signal?.aborted).toBe(true);
    const b = useReviewStore.getState().generateWeekly();
    finishA?.(null);
    await a;
    expect(useReviewStore.getState()).toMatchObject({ generating: true, canCancel: true });
    expect(mocks.list).not.toHaveBeenCalled();
    finishB?.(null);
    await b;
    expect(useReviewStore.getState()).toMatchObject({ generating: false, canCancel: false });
  });
  it('blocks double clicks and cannot report cancellation once confirmed saving begins', async () => {
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    mocks.monthly.mockImplementation(options => {
      signal = options.signal;
      options.onCommit();
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const first = useReviewStore.getState().generateMonthly();
    await useReviewStore.getState().generateMonthly();
    useReviewStore.getState().cancelGeneration();
    expect(signal?.aborted).toBe(false);
    expect(mocks.monthly).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState()).toMatchObject({ generating: true, canCancel: false });
    finish?.();
    await first;
  });
});
