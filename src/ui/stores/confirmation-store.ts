/**
 * 写入确认队列
 *
 * ConfirmationService 需要一个「问用户要不要」的入口，但它在应用层，
 * 拿不到 React。这里把 Promise 拆开存住：request() 返回一个待定的 Promise，
 * 弹窗上点了按钮再 resolve。应用层因此完全不知道 UI 长什么样。
 *
 * 同时只弹一个，其余排队 —— 批量提议时连着弹五个框比不弹更糟。
 */
import { create } from 'zustand';
import type { ActionProposal, ConfirmationPrompt, ConfirmRequest, ConfirmPrompt } from '@application/index';

interface PendingConfirmation {
  proposal: ActionProposal;
  resolve: (approved: boolean) => void;
}

interface SimpleConfirm {
  id: number;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (approved: boolean) => void;
}

interface ConfirmationState {
  pending: PendingConfirmation | null;
  queue: PendingConfirmation[];
  /** 简单确认（删除等），一次只弹一个，其余排队——单槽覆盖会让上一个 Promise 永不 resolve */
  simple: SimpleConfirm | null;
  simpleQueue: SimpleConfirm[];
  request: (proposal: ActionProposal, signal?: AbortSignal) => Promise<boolean>;
  decide: (approved: boolean) => void;
  requestSimple: (input: Omit<SimpleConfirm, 'id' | 'resolve'>) => Promise<boolean>;
  decideSimple: (approved: boolean) => void;
}

let simpleId = 0;

export const useConfirmationStore = create<ConfirmationState>((set, get) => ({
  pending: null,
  queue: [],
  simple: null,
  simpleQueue: [],

  request: (proposal, signal) =>
    new Promise<boolean>((resolve) => {
      if (signal?.aborted) { resolve(false); return; }
      const cancel = () => {
        const state = get();
        if (state.pending === entry) set({ pending: state.queue[0] ?? null, queue: state.queue.slice(1) });
        else set({ queue: state.queue.filter(item => item !== entry) });
        entry.resolve(false);
      };
      const entry = { proposal, resolve: (approved: boolean) => {
        signal?.removeEventListener('abort', cancel);
        resolve(approved);
      } };
      signal?.addEventListener('abort', cancel, { once: true });
      const { pending, queue } = get();
      if (pending) set({ queue: [...queue, entry] });
      else set({ pending: entry });
    }),

  decide: (approved) => {
    const { pending, queue } = get();
    if (!pending) return;

    pending.resolve(approved);
    set({ pending: queue[0] ?? null, queue: queue.slice(1) });
  },

  requestSimple: (input) =>
    new Promise<boolean>((resolve) => {
      simpleId += 1;
      const entry = { ...input, id: simpleId, resolve };
      const { simple, simpleQueue } = get();
      if (simple) set({ simpleQueue: [...simpleQueue, entry] });
      else set({ simple: entry });
    }),

  decideSimple: (approved) => {
    const { simple, simpleQueue } = get();
    if (!simple) return;
    simple.resolve(approved);
    set({ simple: simpleQueue[0] ?? null, simpleQueue: simpleQueue.slice(1) });
  },
}));

/** 交给 createApplication 的确认入口 */
export const uiConfirmationPrompt: ConfirmationPrompt = (proposal, signal) =>
  useConfirmationStore.getState().request(proposal, signal);

/** 交给 createApplication 的简单确认入口（删除等破坏性操作） */
export const uiConfirmPrompt: ConfirmPrompt = (request: ConfirmRequest) =>
  useConfirmationStore.getState().requestSimple(request);
