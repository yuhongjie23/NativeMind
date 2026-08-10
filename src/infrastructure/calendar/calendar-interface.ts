/**
 * 日历 Provider 接口
 *
 * 现阶段只定契约 + 一个空实现。日历是「以后可能接系统日历」的扩展点，
 * 但读日程涉及隐私授权，所以默认关闭：NoopCalendarProvider 永远返回空，
 * 上层拿到空数组就当「今天没有安排」，功能自然退化，不需要判空分支。
 */
import type { ISO8601DateTime } from '@shared-types/common';

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: ISO8601DateTime;
  endAt: ISO8601DateTime;
  allDay: boolean;
  location?: string;
}

export interface CalendarProvider {
  readonly name: string;
  /** 未获授权或平台不支持时返回 false */
  isAvailable(): Promise<boolean>;
  /** 闭区间 YYYY-MM-DD */
  listEvents(from: string, to: string): Promise<CalendarEvent[]>;
}

export class NoopCalendarProvider implements CalendarProvider {
  readonly name = 'noop';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async listEvents(): Promise<CalendarEvent[]> {
    return [];
  }
}

/**
 * 找出日程之间 >= minMinutes 的空档，供「今天什么时候适合专注」建议使用。
 * 纯函数，不依赖具体 Provider，接上真实日历后直接复用。
 */
export const findFreeSlots = (
  events: CalendarEvent[],
  dayStart: Date,
  dayEnd: Date,
  minMinutes = 25
): { startAt: string; endAt: string }[] => {
  const busy = events
    .filter((event) => !event.allDay)
    .map((event) => ({ start: new Date(event.startAt), end: new Date(event.endAt) }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  const slots: { startAt: string; endAt: string }[] = [];
  let cursor = dayStart;

  busy.forEach((block) => {
    if (block.start.getTime() - cursor.getTime() >= minMinutes * 60_000) {
      slots.push({ startAt: cursor.toISOString(), endAt: block.start.toISOString() });
    }
    // 日程可能重叠，游标只能往后走
    if (block.end > cursor) cursor = block.end;
  });

  if (dayEnd.getTime() - cursor.getTime() >= minMinutes * 60_000) {
    slots.push({ startAt: cursor.toISOString(), endAt: dayEnd.toISOString() });
  }

  return slots;
};
