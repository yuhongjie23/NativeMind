/**
 * 专注背景音乐 store
 *
 * 与音乐库（music-store）分开：专注模式专属，循环播放，只在专注会话/全屏层期间用。
 * 读取走 audio_read_imported（数据目录内），选歌时会把本地文件复制进数据目录。
 * 音频元素与 Blob URL 是模块级单例，全屏层开关之间不丢。
 */
import { create } from 'zustand';
import { readImportedBytes } from '@infrastructure/paths/paths-api';
import { clearActiveSource, registerAudioStopper, silenceOthers } from './audio-exclusive';
import { describeError } from './runtime';
import { useToastStore } from './toast-store';
import { mimeByExtension } from './music-store';

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;

const getAudio = (): HTMLAudioElement => {
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
  }
  return audio;
};

interface FocusMusicState {
  /** 已配置的专注音乐文件路径 */
  file?: string;
  playing: boolean;
  /** 读取/播放失败信息（可感知状态） */
  error?: string;
  /** 0-1 主音量（跟随右上角音量） */
  volume: number;
  muted: boolean;
  setFile: (file?: string) => void;
  play: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  toggle: () => Promise<void>;
  setVolume: (value: number) => void;
  setMuted: (muted: boolean) => void;
}

export const useFocusMusicStore = create<FocusMusicState>((set, get) => ({
  file: undefined,
  playing: false,
  error: undefined,
  volume: 0.8,
  muted: false,

  setFile: (file) => {
    set({ file, error: undefined });
    if (!file) {
      audio?.pause();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      set({ playing: false });
    }
  },

  play: async () => {
    const { file, volume, muted } = get();
    if (!file) return;
    // 同一时刻只响一个：停掉环境音 / 音乐库 / 自定义天气歌
    silenceOthers('focus');
    const element = getAudio();
    // 新建元素时套用当前主音量/静音，别以默认 1.0 音量突然响起
    element.volume = muted ? 0 : volume;
    element.muted = muted;
    try {
      const bytes = await readImportedBytes(file);
      if (!bytes || bytes.byteLength === 0) {
        set({ playing: false, error: '音乐文件为空' });
        useToastStore.getState().show('专注音乐文件为空，无法播放', 'error');
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeByExtension(file) }));
      element.src = objectUrl;
      await element.play();
      set({ playing: true, error: undefined });
    } catch (error) {
      // 自动播放被 WebView/浏览器拦（读字节是异步的，用户激活已丢失）：
      // 不弹吓人的错误，等下一个手势由 UI 层重试
      set({ playing: false, error: undefined });
      const name = (error as DOMException)?.name;
      if (name !== 'NotAllowedError') {
        useToastStore.getState().show(describeError(error), 'error');
      }
    }
  },

  stop: () => {
    audio?.pause();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    set({ playing: false });
    clearActiveSource('focus');
  },

  /** 互斥用：只暂停不清文件（别的音源接管后，还能切回来继续） */
  pause: () => {
    audio?.pause();
    set({ playing: false });
    clearActiveSource('focus');
  },

  toggle: async () => {
    if (get().playing) {
      audio?.pause();
      set({ playing: false });
      return;
    }
    await get().play();
  },

  setVolume: (value) => {
    const clamped = Math.max(0, Math.min(1, value));
    set({ volume: clamped });
    if (audio) audio.volume = clamped;
  },

  setMuted: (muted) => {
    set({ muted });
    if (audio) audio.muted = muted;
  },
}));

// 互斥：别的音源播放时，暂停专注音乐（保留文件，可切回）
registerAudioStopper('focus', () => {
  useFocusMusicStore.getState().pause();
});
