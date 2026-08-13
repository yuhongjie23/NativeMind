/**
 * 日期工具回归测试
 *
 * 之前 `today()` 和各处 `toISOString().slice(0,10)` 取的是 UTC 日期，
 * 东八区凌晨 0–8 点会差一天。这两个助手必须走本地时区。
 */
import { describe, expect, it } from 'vitest';
import { formatLocalDate, isSameLocalDay } from '@application/shared/utils';

describe('formatLocalDate', () => {
  it('用本地年月日拼接，而不是 UTC 切片', () => {
    // 2026-08-02T20:00:00Z：东八区是 08-03 凌晨 4 点，UTC 日期是 08-02
    const instant = new Date('2026-08-02T20:00:00Z');
    const expected = [
      instant.getFullYear(),
      String(instant.getMonth() + 1).padStart(2, '0'),
      String(instant.getDate()).padStart(2, '0'),
    ].join('-');
    expect(formatLocalDate(instant)).toBe(expected);
    // 用一组跨日期边界的时刻确保不是 toISOString() 的退化实现
    for (const iso of ['2026-08-02T16:30:00Z', '2026-08-03T00:00:00Z', '2026-01-01T12:00:00Z']) {
      const d = new Date(iso);
      expect(formatLocalDate(d)).toBe(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      );
    }
  });
});

describe('isSameLocalDay', () => {
  it('把 UTC 时间戳转回本地日再比较', () => {
    const ref = new Date(2026, 7, 3, 12, 0); // 本地 2026-08-03 中午
    const sameDay = new Date(2026, 7, 3, 0, 30).toISOString();
    const prevDay = new Date(2026, 7, 2, 23, 0).toISOString();
    expect(isSameLocalDay(sameDay, ref)).toBe(true);
    expect(isSameLocalDay(prevDay, ref)).toBe(false);
  });
});
