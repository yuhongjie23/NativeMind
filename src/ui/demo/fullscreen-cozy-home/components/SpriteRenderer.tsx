/**
 * Sprite Sheet 桌宠渲染器（代码侧，不含美术）。
 *
 * 按 Manifest 的帧列表 / fps / 逐帧时长 / 循环播放；帧变更时才重渲染。
 * reduced-motion 时只显示 reducedMotionFrame 静态帧。
 * 一次性动作播完（ended）→ 触发 onComplete，由上层走 fallback / 降级链。
 * 图片缺失或加载失败 → 上层 CSS PetActor 兜底。
 */
import { useEffect, useRef, useState } from 'react';
import { frameOffset, spriteFrameAt } from '../sprite-manifest';
import type { AnimationDescriptor } from '../types';

const usePrefersReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
};

interface SpriteRendererProps {
  descriptor: AnimationDescriptor;
  onComplete?: () => void;
}

export function SpriteRenderer({ descriptor, onComplete }: SpriteRendererProps) {
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const reducedMotion = usePrefersReducedMotion();

  const frames = descriptor.frames ?? [];
  const frameW = descriptor.frameWidth ?? 192;
  const frameH = descriptor.frameHeight ?? 208;
  const columns = descriptor.columns ?? 8;
  const rows = descriptor.rows ?? 9;

  const [current, setCurrent] = useState({ frame: descriptor.reducedMotionFrame ?? frames[0] ?? 0, ended: false });
  const endedRef = useRef(false);
  const lastFrameRef = useRef(-1);

  useEffect(() => {
    // reduced-motion：静态帧，不调度
    if (reducedMotion || frames.length === 0) {
      setCurrent({ frame: descriptor.reducedMotionFrame ?? frames[0] ?? 0, ended: frames.length === 0 });
      return;
    }
    endedRef.current = false;
    lastFrameRef.current = -1;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const { frame, ended } = spriteFrameAt(performance.now() - start, frames, {
        fps: descriptor.fps,
        frameDurationsMs: descriptor.frameDurationsMs,
        loop: descriptor.loop,
        loopStart: descriptor.loopStart,
      });
      if (frame !== lastFrameRef.current || ended) {
        lastFrameRef.current = frame;
        setCurrent({ frame, ended });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, frames.join(','), descriptor.loop, descriptor.loopStart, descriptor.fps, descriptor.frameDurationsMs?.join(',')]);

  // 一次性动作播完 → 触发 fallback（Scene Director / resolver 处理）
  useEffect(() => {
    if (current.ended && !endedRef.current) {
      endedRef.current = true;
      completeRef.current?.();
    }
  }, [current.ended]);

  const offset = frameOffset(current.frame, frameW, frameH, columns);
  // 展示缩放：桌面宠物缩小显示（宽度/高度/背景偏移/背景尺寸同比例），帧对齐不变
  const scale = descriptor.scale ?? 1;
  const style = descriptor.src
    ? {
        width: frameW * scale,
        height: frameH * scale,
        backgroundImage: `url("${descriptor.src}")`,
        backgroundPosition: `${offset.x * scale}px ${offset.y * scale}px`,
        backgroundSize: `${frameW * columns * scale}px ${frameH * rows * scale}px`,
        backgroundRepeat: 'no-repeat',
      }
    : { width: frameW * scale, height: frameH * scale };

  return (
    <div
      className="sprite-renderer"
      data-sprite-frame={current.frame}
      data-ended={current.ended}
      style={style}
      aria-hidden="true"
    />
  );
}
