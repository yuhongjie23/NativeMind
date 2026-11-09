import { useEffect, useRef, useState } from 'react';
import { readBackgroundVideo } from '@infrastructure/background-video';
import { useSettingsStore } from '../../../stores/settings-store';
import { t } from '../../../i18n';
import { resolveBackground } from '../backgrounds';
import { backgroundSlot } from '../background-slot';
import type { SceneId, TimePhase, WeatherType } from '../types';

/** Local, silent videos; keep the built-in scene visible while loading or on failure. */
export function ImageBackground({ weather, timePhase, scene, paused = false }: {
  weather: WeatherType; timePhase: TimePhase; scene: SceneId; paused?: boolean;
}) {
  const slot = backgroundSlot(scene, weather, timePhase);
  const path = useSettingsStore(state => state.backgroundVideos[slot]);
  const [loaded, setLoaded] = useState<{ path: string; url: string }>();
  const [failed, setFailed] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  const builtin = resolveBackground(weather, timePhase, scene);
  const poster = builtin.kind === 'image' ? builtin.src : resolveBackground(weather, 'dusk', scene).src;
  const custom = loaded?.path === path && loaded?.url !== failed ? loaded : undefined;
  const asset = custom ? { kind: 'video', src: custom.url } : builtin;
  const src = asset.src;

  useEffect(() => {
    setLoaded(undefined);
    if (!path) return;
    const controller = new AbortController();
    let url: string | undefined;
    useSettingsStore.getState().setBackgroundError(slot);
    void readBackgroundVideo(path, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setLoaded({ path, url });
    }).catch(() => {
      if (!controller.signal.aborted) useSettingsStore.getState().setBackgroundError(slot, t('视频无法读取，已使用内置背景。请重新选择本地视频。'));
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [path, slot]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      if (paused || document.hidden) element.pause();
      else void element.play().catch(() => { /* Autoplay can wait for a user gesture. */ });
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    document.addEventListener('pointerdown', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('pointerdown', sync);
      element.pause();
    };
  }, [src, paused]);

  if (asset.kind !== 'video' || src === failed) {
    return <img className="layer-background__img" src={src === failed ? poster : src} alt="" aria-hidden="true" />;
  }
  return <video ref={video} key={src} className="layer-background__video" src={src}
    poster={poster} muted loop playsInline preload="metadata" aria-hidden="true"
    onError={() => {
      setFailed(src);
      if (custom) useSettingsStore.getState().setBackgroundError(slot, t('视频无法播放，已使用内置背景。请使用浏览器支持的 MP4 / WebM 编码。'));
    }} />;
}
