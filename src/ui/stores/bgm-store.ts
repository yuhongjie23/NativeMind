/**
 * 背景音乐开关（场景音乐，useBackgroundMusic 播放的那一路）。
 *
 * LofiHud 音乐栏的播放/暂停按钮需要控制它；默认自动播放，
 * 用户点暂停后停，再点恢复。scene 变化会自动换歌并恢复播放。
 */
import { create } from 'zustand';

interface BgmState {
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  /** 切换播放/暂停（音乐栏按钮触发） */
  toggle: () => void;
}

export const useBgmStore = create<BgmState>((set, get) => ({
  playing: false,
  setPlaying: (playing) => set({ playing }),
  toggle: () => set({ playing: !get().playing }),
}));
