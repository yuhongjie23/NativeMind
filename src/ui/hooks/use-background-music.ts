/**
 * 背景内置音乐：随 (scene, weather, timePhase) 切换播放对应音乐文件。
 *
 * - 音乐是 bundle 资源（src-tauri/resources/audio/backgrounds/），运行时经
 *   bgm_read（IPC 读字节）→ Blob 循环播放；文件缺失 / 未映射 → 静默。
 * - 通过 audio-exclusive 注册为独立音源：用户播音乐 / 专注音乐时被 silenceOthers 停掉，
 *   音量键、全局静音同样生效；用户放音乐时背景音乐不抢（getActiveSource 检查）。
 * - reloadKey：顶栏背景音乐开关在「开」时自增，强制重新加载当前场景的背景音乐
 *   （覆盖 autoplay 被拦 / 曾 stop 清掉 src 后再次开启的场景）。
 */
import { useCallback, useEffect, useRef } from 'react';
import { getAppPaths, readBgmBytes } from '@infrastructure/paths/paths-api';
import { backgroundMusicFor } from '../demo/fullscreen-cozy-home/background-music';
import type { SceneId, TimePhase, WeatherType } from '../demo/fullscreen-cozy-home/types';
import { mimeByExtension } from '../stores/music-store';
import { useBgmStore } from '../stores/bgm-store';
import {
  clearActiveSource,
  getActiveSource,
  getMasterMuted,
  getMasterVolume,
  registerAudioStopper,
  silenceOthers,
  subscribeMasterMuted,
  subscribeMasterVolume,
  unregisterAudioStopper,
} from '../stores/audio-exclusive';

const SOURCE_ID = 'background-music';

let cachedResourceDir = '';
const getResourceDir = async (): Promise<string> => {
  if (cachedResourceDir) return cachedResourceDir;
  try {
    const { resourceDir } = await getAppPaths();
    cachedResourceDir = resourceDir ?? '';
  } catch {
    cachedResourceDir = '';
  }
  return cachedResourceDir;
};

export function useBackgroundMusic(
  scene: SceneId,
  weather: WeatherType,
  timePhase: TimePhase,
  reloadKey = 0
): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const playing = useBgmStore((state) => state.playing);

  // 停止：暂停、释放 Blob URL、清掉音源互斥；文件缺失 / 被抢占也走这
  const stop = useCallback(() => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.removeAttribute('src');
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    clearActiveSource(SOURCE_ID);
    useBgmStore.getState().setPlaying(false);
  }, []);

  // 注册停止器 + 卸载清理；加载失败（文件缺失/空）→ 静默
  useEffect(() => {
    const audio = audioRef.current ?? (audioRef.current = new Audio());
    audio.loop = true;
    audio.onerror = () => {
      stop();
    };
    registerAudioStopper(SOURCE_ID, stop);
    return () => {
      unregisterAudioStopper(SOURCE_ID);
      stop();
    };
  }, [stop]);

  // 音乐栏按钮切换播放/暂停
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      if (audio.getAttribute('src') && audio.paused) {
        void audio.play().catch(() => {});
      }
    } else {
      audio.pause();
    }
  }, [playing]);

  // 背景变化 / 手动重新加载 → 经 bgm_read 读字节 → Blob → 循环播放
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;
    const file = backgroundMusicFor(scene, weather, timePhase);

    const apply = async () => {
      // 该背景暂无对应音乐（如夏日）→ 静默
      if (!file) {
        stop();
        return;
      }
      // 用户显式放自己的音乐（音乐库/专注音乐/自定义音频）→ 背景音乐不抢
      const active = getActiveSource();
      if (active === 'library' || active === 'focus' || active === 'custom') {
        audio.pause();
        return;
      }
      const resourceDir = await getResourceDir();
      if (cancelled) return;
      if (!resourceDir) {
        // 浏览器预览 / 拿不到资源目录 → 静默
        stop();
        return;
      }
      // bgm_read 按 resourceDir/audio/backgrounds 下校验，须传完整路径（裸文件名 canonicalize 会失败）
      const full = `${resourceDir.replace(/[\\/]+$/, '')}/audio/backgrounds/${file}`;
      let bytes: ArrayBuffer;
      try {
        bytes = await readBgmBytes(full);
      } catch {
        // effect 已卸载（场景切换）：不能碰当前场景的 audio
        if (cancelled) return;
        // 文件缺失 / 不可读：静默（环境音不弹提示）
        stop();
        return;
      }
      if (cancelled) return;
      if (!bytes || bytes.byteLength === 0) {
        stop();
        return;
      }
      // 读字节期间用户开始放自己的音乐 → 不抢
      const activeNow = getActiveSource();
      if (activeNow === 'library' || activeNow === 'focus' || activeNow === 'custom') {
        audio.pause();
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const blob = new Blob([bytes], { type: mimeByExtension(file) });
      urlRef.current = URL.createObjectURL(blob);
      audio.src = urlRef.current;
      // 同一时刻只响一个：停掉内置环境音等其它源（背景音乐可以让位）
      silenceOthers(SOURCE_ID);
      void audio.play().catch(() => {
        // 自动播放被拦 / 文件不可读：安静处理，等用户手势后由 reloadKey 重试
      });
      useBgmStore.getState().setPlaying(true);
    };
    void apply();
    return () => {
      cancelled = true;
    };
  }, [scene, weather, timePhase, reloadKey, stop]);

  // 主音量 / 全局静音跟随
  useEffect(() => {
    const apply = () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = getMasterVolume();
      audio.muted = getMasterMuted();
    };
    apply();
    const offVolume = subscribeMasterVolume(apply);
    const offMute = subscribeMasterMuted(apply);
    return () => {
      offVolume();
      offMute();
    };
  }, []);
}
