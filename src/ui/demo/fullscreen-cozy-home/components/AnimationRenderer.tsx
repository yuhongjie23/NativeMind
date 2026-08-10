/**
 * 统一动画渲染器（V4 §26 / §48）。
 *
 * 根据 descriptor.renderer 选择 CSS fallback / <video> / Lottie / Rive / sprite。
 * 上层角色组件只传语义动作，不关心具体渲染技术。
 * 当前无正式资源，全部落到 CSS fallback（children）。
 */
import { useEffect, useRef } from 'react';
import type { AnimationDescriptor } from '../types';
import { SpriteRenderer } from './SpriteRenderer';

interface AnimationRendererProps {
  descriptor: AnimationDescriptor;
  onComplete?: () => void;
  children: React.ReactNode;
  label?: string;
}

export function AnimationRenderer({
  descriptor,
  onComplete,
  children,
  label,
}: AnimationRendererProps) {
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (descriptor.renderer === 'video' && videoRef.current) {
      videoRef.current.playbackRate = descriptor.playbackRate ?? 1;
    }
  }, [descriptor]);

  if (descriptor.renderer === 'css') return <>{children}</>;
  if (descriptor.renderer === 'sprite') {
    return <SpriteRenderer descriptor={descriptor} onComplete={onComplete} />;
  }

  return (
    <div className="animation-renderer" data-renderer={descriptor.renderer} aria-hidden={!label}>
      <video
        ref={videoRef}
        src={descriptor.src}
        poster={descriptor.poster}
        muted
        playsInline
        loop={descriptor.loop}
        onEnded={() => completeRef.current?.()}
        onError={() => completeRef.current?.()}
        aria-hidden="true"
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
