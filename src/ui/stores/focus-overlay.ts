/**
 * 全屏专注开关（跨组件共享）
 *
 * 全屏层由 FullscreenCozyHome 渲染；Today 面板的「开始专注」、
 * 底部 dock 的「专注」都能触发它。把状态从 FullscreenCozyHome 的
 * 局部 state 提出来，让任意组件能直接进入 / 退出全屏专注。
 */
import { create } from 'zustand';
import { useFocusMusicStore } from './focus-music';

interface FocusOverlayState {
  open: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
}

export const useFocusOverlayStore = create<FocusOverlayState>((set) => ({
  open: false,
  openOverlay: () => set({ open: true }),
  closeOverlay: () => {
    // 退出全屏专注 → 专注音乐同步暂停（安静下来）。
    // 会话可能仍在后台计时，但音乐不该在退出全屏后继续响。
    useFocusMusicStore.getState().pause();
    set({ open: false });
  },
}));
