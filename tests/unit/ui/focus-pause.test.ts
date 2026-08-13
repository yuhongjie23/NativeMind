/**
 * 专注暂停：remainingSeconds 的冻结 / 累加语义
 */
import { describe, expect, it } from 'vitest';
import { remainingSeconds } from '@ui/hooks/use-focus-mode';

const START = '2026-01-01T00:00:00.000Z';
const DURATION = 10; // 10 分钟 = 600s

describe('remainingSeconds（暂停语义）', () => {
  it('暂停中：剩余时间冻结在暂停时刻，不随真实时间继续减少', () => {
    // 第 180 秒（3 分钟）暂停
    const pausedAt = new Date(new Date(START).getTime() + 180_000).toISOString();
    // pausedAt 固定 → 不依赖 Date.now()，两次调用结果一致
    expect(remainingSeconds(START, DURATION, pausedAt, 0)).toBe(420);
    expect(remainingSeconds(START, DURATION, pausedAt, 0)).toBe(420);
  });

  it('恢复后：已累计的暂停秒数不计入流逝，剩余时间相应变多', () => {
    // 暂停时长从「有效流逝」里排除：暂停 60s，剩余就多 60s
    const pausedAt = new Date(new Date(START).getTime() + 300_000).toISOString();
    const noExtra = remainingSeconds(START, DURATION, pausedAt, 0);
    const withPause = remainingSeconds(START, DURATION, pausedAt, 60);
    expect(withPause - noExtra).toBe(60);
  });

  it('剩余为 0 时钳到 0', () => {
    const pausedAt = new Date(new Date(START).getTime() + 600_000).toISOString();
    expect(remainingSeconds(START, DURATION, pausedAt, 0)).toBe(0);
  });
});
