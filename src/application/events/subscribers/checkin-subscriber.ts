/**
 * 每日打卡订阅者
 *
 * 任务确认/完成/更新/删除、专注完成 → 重算当日打卡快照。
 * 用事件时间戳的本地日期重算，跨天收尾（昨晚的任务今天才完成）也能落到正确的那天。
 * 订阅者失败不影响主流程（EventBus 用 allSettled 派发）。
 */
import type { ISO8601DateTime } from '@shared-types/common';
import { formatLocalDate } from '../../shared/utils';
import type { RecordDailyCheckInUseCase } from '../../use-cases/checkin/record-daily-checkin';
import type { EventBus } from '../event-bus';

export const registerCheckInSubscriber = (
  eventBus: EventBus,
  record: RecordDailyCheckInUseCase
): (() => void) => {
  const recordDay = (timestamp: ISO8601DateTime): void => {
    const date = formatLocalDate(new Date(timestamp));
    void record.execute(date).catch(() => undefined);
  };

  const offs = [
    eventBus.subscribe('TodoConfirmed', (event) => recordDay(event.timestamp)),
    eventBus.subscribe('TodoCompleted', (event) => recordDay(event.timestamp)),
    eventBus.subscribe('TodoUpdated', (event) => recordDay(event.timestamp)),
    eventBus.subscribe('TodoDeleted', (event) => recordDay(event.timestamp)),
    eventBus.subscribe('FocusSessionCompleted', (event) => recordDay(event.timestamp)),
  ];
  return () => offs.forEach((off) => off());
};
