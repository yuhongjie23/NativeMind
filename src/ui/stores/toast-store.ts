/**
 * 轻量 toast 反馈
 * 只做「操作成功/失败」的短暂提示，不承载决策；确认弹窗那类仍走 Modal。
 */
import { create } from 'zustand';

export type ToastKind = 'ok' | 'error' | 'info';

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: ToastItem[];
  show: (text: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (text, kind = 'info') => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, text, kind }] }));
    // 自动消失；组件卸载时由 dismiss 清理
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 2600);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
