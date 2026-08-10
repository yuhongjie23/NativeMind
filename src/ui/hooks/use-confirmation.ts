/**
 * 读取当前待确认的提议
 *
 * 组件只需要「有没有要确认的东西」和「同意/拒绝」两个动作，
 * 队列细节留在 store 里。
 */
import type { ActionProposal } from '@application/index';
import { useConfirmationStore } from '../stores/confirmation-store';

export interface ConfirmationView {
  proposal: ActionProposal | null;
  /** 后面还排着几个 */
  queued: number;
  approve: () => void;
  reject: () => void;
}

export function useConfirmation(): ConfirmationView {
  const pending = useConfirmationStore((state) => state.pending);
  const queued = useConfirmationStore((state) => state.queue.length);
  const decide = useConfirmationStore((state) => state.decide);

  return {
    proposal: pending?.proposal ?? null,
    queued,
    approve: () => decide(true),
    reject: () => decide(false),
  };
}
