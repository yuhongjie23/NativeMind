/** 本地时间与格式化工具（纯函数，无业务依赖）。 */

import type { TimePhase } from './types';

const pad = (value: number): string => String(value).padStart(2, '0');

export const formatClock = (date: Date): string =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const formatCountdown = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const formatDateLong = (date: Date): string =>
  `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;

/** 06:00-15:59 day，16:00-18:59 dusk，19:00-05:59 night（V4 §19） */
export function phaseForHour(hour: number): TimePhase {
  if (hour >= 6 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}
