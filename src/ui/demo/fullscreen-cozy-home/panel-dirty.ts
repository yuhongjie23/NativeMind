/**
 * 面板未完成状态登记。
 *
 * 各面板在本地草稿有内容时上报 dirty，DemoSheet / 根组件据此在关闭前
 * 弹确认，避免用户误关丢未完成的任务与结果。
 */
import { create } from 'zustand';
import type { PanelKey } from './types';

interface PanelDirtyState {
  dirty: Partial<Record<PanelKey, boolean>>;
  setDirty: (panel: PanelKey, value: boolean) => void;
}

export const usePanelDirty = create<PanelDirtyState>((set) => ({
  dirty: {},
  setDirty: (panel, value) =>
    set((state) => ({ dirty: { ...state.dirty, [panel]: value } })),
}));
