/**
 * 音乐播放 store
 *
 * 之前播放逻辑住在 use-music-player hook 里，Audio 元素跟着组件卸载，
 * 一切页面音乐就停了。这里把播放核心提到**模块级单例**：
 * audio 元素与 Blob URL 存活于模块作用域，切页组件卸载不影响播放。
 *
 * 专注页的音乐面板只是控制端，真正的播放状态与进度都在这里。
 */

import { create } from 'zustand';
import { listMusic, readMusicBytes, type MusicAsset } from '@infrastructure/paths/paths-api';
import { clearActiveSource, registerAudioStopper, silenceOthers } from './audio-exclusive';
import { describeError } from './runtime';
import { useToastStore } from './toast-store';

export type PlayMode = 'sequence' | 'shuffle';

/** 按扩展名给 Blob 定 MIME，取不到就用通用的 audio/mpeg */
export const mimeByExtension = (name: string): string => {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/mpeg';
  }
};

/** 下一首：顺序下标 +1 循环；随机抽一个不同下标（单曲时不变） */
export const nextIndex = (index: number, count: number, mode: PlayMode): number => {
  if (mode === 'shuffle' && count > 1) {
    let next = index;
    while (next === index) next = Math.floor(Math.random() * count);
    return next;
  }
  return (index + 1) % count;
};

/** 上一首：下标 -1 循环 */
export const prevIndex = (index: number, count: number): number => (index - 1 + count) % count;

// 模块级单例：组件卸载不清空，页面切换音乐继续
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
// 播放请求序号：读字节是异步的，快速切歌时最慢的读取不能覆盖新选择
let playToken = 0;

const getAudio = (): HTMLAudioElement => {
  if (!audio) {
    audio = new Audio();
    audio.volume = useMusicStore.getState().volume;
    audio.onended = () => {
      const { tracks, current, mode } = useMusicStore.getState();
      if (tracks.length === 0) return;
      const index = current ? tracks.findIndex((track) => track.path === current.path) : -1;
      void useMusicStore
        .getState()
        .playAt(nextIndex(index < 0 ? 0 : index, tracks.length, mode));
    };
  }
  return audio;
};

interface MusicState {
  tracks: MusicAsset[];
  current: MusicAsset | undefined;
  playing: boolean;
  mode: PlayMode;
  loadingTracks: boolean;
  /** 0-1 主音量，右上角音量面板控制 */
  volume: number;
  /** 全部静音开关，右上角音量面板控制 */
  muted: boolean;
  /** 重新拉取音乐目录清单（音乐目录变化时调用） */
  refresh: () => Promise<void>;
  /** 选中一首播放 */
  play: (track: MusicAsset) => Promise<void>;
  /** 按清单下标播放，内部用（自动下一首走这里） */
  playAt: (index: number) => Promise<void>;
  toggle: () => Promise<void>;
  /** 只暂停不清选中曲目 */
  pause: () => void;
  next: () => void;
  prev: () => void;
  toggleMode: () => void;
  stop: () => void;
  setVolume: (value: number) => void;
  setMuted: (muted: boolean) => void;
}

export const useMusicStore = create<MusicState>((set, get) => ({
  tracks: [],
  current: undefined,
  playing: false,
  mode: 'sequence',
  loadingTracks: false,
  volume: 0.8,
  muted: false,

  refresh: async () => {
    set({ loadingTracks: true });
    try {
      const tracks = await listMusic();
      set({ tracks, loadingTracks: false });

      // 当前曲目已不在新清单里（目录变了）→ 停掉
      const { current } = get();
      if (current && !tracks.some((track) => track.path === current.path)) {
        get().stop();
      }
    } catch {
      set({ loadingTracks: false });
    }
  },

  play: async (track) => {
    const index = get().tracks.findIndex((item) => item.path === track.path);
    if (index < 0) return;
    await get().playAt(index);
  },

  playAt: async (index) => {
    const list = get().tracks;
    if (index < 0 || index >= list.length) return;
    const track = list[index];
    const token = ++playToken;

    const element = getAudio();
    let bytes: ArrayBuffer;
    try {
      bytes = await readMusicBytes(track.path);
    } catch (error) {
      // 已是过期请求（用户又点了别的歌）就不打扰；否则不能无提示地卡在「未选择」状态
      if (token !== playToken) return;
      get().stop();
      useToastStore.getState().show(describeError(error), 'error');
      return;
    }
    // 读字节期间用户又点了别的歌 / 点了停止：丢弃这次结果，
    // 避免慢读取覆盖新选择，或 revoke 掉新曲目的 objectUrl
    if (token !== playToken) return;
    if (!bytes || bytes.byteLength === 0) {
      get().stop();
      useToastStore.getState().show('音乐文件为空，无法播放', 'error');
      return;
    }
    // 读到了才互斥：读取期间别的音源照常（背景视频不静音、bgm 不被停）；
    // 读失败也不会白白把当前声音停掉
    silenceOthers('library');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const blob = new Blob([bytes], { type: mimeByExtension(track.name) });
    objectUrl = URL.createObjectURL(blob);

    element.src = objectUrl;
    set({ current: track });
    try {
      await element.play();
      set({ playing: true });
    } catch {
      set({ playing: false });
    }
  },

  toggle: async () => {
    const { current, playing } = get();
    if (!current || !audio) return;
    if (playing) {
      audio.pause();
      set({ playing: false });
      return;
    }
    try {
      await audio.play();
      set({ playing: true });
    } catch {
      set({ playing: false });
    }
  },

  /** 只暂停不清选中曲目（专注/全屏时用，退出后还能继续听） */
  pause: () => {
    audio?.pause();
    set({ playing: false });
    clearActiveSource('library');
  },

  next: () => {
    const { tracks, current, mode } = get();
    if (tracks.length === 0) return;
    const index = current ? tracks.findIndex((track) => track.path === current.path) : -1;
    void get().playAt(nextIndex(index < 0 ? 0 : index, tracks.length, mode));
  },

  prev: () => {
    const { tracks, current } = get();
    if (tracks.length === 0) return;
    const index = current ? tracks.findIndex((track) => track.path === current.path) : -1;
    void get().playAt(prevIndex(index < 0 ? 0 : index, tracks.length));
  },

  toggleMode: () => {
    set({ mode: get().mode === 'sequence' ? 'shuffle' : 'sequence' });
  },

  stop: () => {
    playToken += 1; // 使在途的 playAt 结果作废
    audio?.pause();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    set({ current: undefined, playing: false });
    clearActiveSource('library');
  },

  setVolume: (value) => {
    const clamped = Math.max(0, Math.min(1, value));
    const element = getAudio();
    element.volume = clamped;
    set({ volume: clamped });
  },

  setMuted: (muted) => {
    const element = getAudio();
    element.muted = muted;
    set({ muted });
  },
}));

// 互斥：别的音源播放时，暂停音乐库（保留选中曲目，可恢复）
registerAudioStopper('library', () => {
  useMusicStore.getState().pause();
});
