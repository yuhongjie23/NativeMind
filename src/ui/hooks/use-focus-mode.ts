/**
 * 专注倒计时
 *
 * 剩余时间按 startedAt 与当前时间之差算，不做自增计数。浏览器会节流
 * 后台标签页的 setInterval，自增会越走越慢；按时间戳算则不受影响。
 *
 * 走到 0 只上报 elapsed，不自动调 completeFocus —— 是否记完成由用户决定，
 * 组件自己接 onElapsed 处理。
 */
import { useEffect, useRef, useState } from 'react';
import { useFocusStore } from '../stores/focus-store';

/**
 * 剩余秒数。暂停期间用 pausedAt 冻结「已流逝时间」：effectiveElapsed 不再前进，
 * 剩余时间保持不变；恢复时把暂停时长累进 pausedSeconds 继续扣。
 */
export const remainingSeconds = (
  startedAt: string,
  durationMinutes: number,
  pausedAt: string | null,
  pausedSeconds: number
): number => {
  const frozen = pausedAt ? new Date(pausedAt).getTime() : Date.now();
  const effectiveElapsed = (frozen - new Date(startedAt).getTime()) / 1000 - pausedSeconds;
  return Math.max(0, Math.round(durationMinutes * 60 - effectiveElapsed));
};

export interface FocusModeView {
  isActive: boolean;
  remaining: number;
  /** mm:ss */
  display: string;
  progress: number;
}

export function useFocusMode(onElapsed?: () => void): FocusModeView {
  const active = useFocusStore((state) => state.active);
  const pausedAt = useFocusStore((state) => state.pausedAt);
  const pausedSeconds = useFocusStore((state) => state.pausedSeconds);
  const [remaining, setRemaining] = useState(0);

  const elapsedFiredRef = useRef(false);
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;

  useEffect(() => {
    if (!active) {
      setRemaining(0);
      return;
    }

    elapsedFiredRef.current = false;
    // 首次 tick 若已经归零（重启恢复的过期会话），不弹「专注结束」——
    // 那只是幽灵会话，真实归零发生在本次运行过程中才值得提醒
    let firstTick = true;

    const tick = () => {
      const next = remainingSeconds(active.startedAt, active.durationMinutes, pausedAt, pausedSeconds);
      setRemaining(next);

      if (firstTick) {
        firstTick = false;
        if (next === 0) return;
      }

      // 只触发一次，否则归零后每秒都会回调
      if (next === 0 && !elapsedFiredRef.current) {
        elapsedFiredRef.current = true;
        onElapsedRef.current?.();
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, pausedAt, pausedSeconds]);

  const total = (active?.durationMinutes ?? 0) * 60;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return {
    isActive: Boolean(active),
    remaining,
    display: active
      ? `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : '--:--',
    progress: total > 0 ? (total - remaining) / total : 0,
  };
}
