/**
 * 应用层通用工具
 */
import type { ISO8601DateTime, UUID } from '@shared-types/common';

/** 当前时间（ISO8601） */
export const now = (): ISO8601DateTime => new Date().toISOString();

/** 把 Date 转成**本地**时区的 YYYY-MM-DD。
 * 不要用 `toISOString().slice(0,10)` —— 那是 UTC 日期，东八区凌晨 0–8 点会差一天。 */
export const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** 当天日期（YYYY-MM-DD，本地时区） */
export const today = (): string => formatLocalDate(new Date());

/**
 * 判断一个 ISO8601 时间戳与参考时刻是否落在**同一个本地日**。
 * 存库的 created_at 是 UTC，用 `slice(0,10)` 和「今天」比会在东八区凌晨错位；
 * 这个方法先把时间戳转回本地再比较年月日，跨时区都正确。
 */
export const isSameLocalDay = (isoTimestamp: string, reference: Date = new Date()): boolean => {
  const instant = new Date(isoTimestamp);
  return (
    instant.getFullYear() === reference.getFullYear() &&
    instant.getMonth() === reference.getMonth() &&
    instant.getDate() === reference.getDate()
  );
};

/** 生成实体 ID */
export const newId = (): UUID => crypto.randomUUID();

/** 距某时间点的分钟数 */
export const minutesSince = (timestamp: ISO8601DateTime): number =>
  (Date.now() - new Date(timestamp).getTime()) / 60000;
