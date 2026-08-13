/**
 * Scene Director（V4 §9 / §27 / §31）。
 *
 * 只操作语义动作，不知道任何资源路径。每个 actor 独立一条队列：
 * 高优先级动作可打断低优先级循环；单次动作按 durationMs 完成后进入
 * returnTo / 链上下一个 / 队列 / 基准动作。宠物与女孩互不覆盖。
 */

import { useEffect, useRef, useState } from 'react';
import { resolveAnimation } from './asset-resolver';

export interface CueOptions {
  priority?: number;
  /** 单次动作完成后依次播放的链（如 sleep_enter -> sleep_loop） */
  chain?: string[];
  /** 显式覆盖 returnTo */
  returnTo?: string;
}

interface PlayState {
  action: string;
  priority: number;
  loop: boolean;
  returnTo?: string;
  chain: string[];
  queued: string | null;
}

const loopPriorities = new Map<string, number>([
  ['idle', 10],
  ['sleep_loop', 10],
  ['look_at_girl', 30],
  ['writing', 40],
]);

const basePriority = (action: string): number => loopPriorities.get(action) ?? 50;

export function useActorQueue<A extends string>(actor: 'girl' | 'pet', base: A) {
  const [state, setState] = useState<PlayState>(() => ({
    action: base,
    priority: 10,
    loop: true,
    chain: [],
    queued: null,
  }));
  const stateRef = useRef(state);
  const timerRef = useRef<number | undefined>(undefined);

  const apply = (next: PlayState) => {
    stateRef.current = next;
    setState(next);
  };

  const scheduleComplete = (playState: PlayState) => {
    window.clearTimeout(timerRef.current);
    if (playState.loop) return;
    const descriptor = resolveAnimation(actor, playState.action);
    if (!descriptor.durationMs) return;
    timerRef.current = window.setTimeout(() => finish(playState), descriptor.durationMs);
  };

  const play = (action: string, priority: number, chain: string[]) => {
    const descriptor = resolveAnimation(actor, action);
    const next: PlayState = {
      action,
      priority,
      loop: descriptor.loop,
      returnTo: descriptor.returnTo,
      chain,
      queued: null,
    };
    apply(next);
    scheduleComplete(next);
  };

  const finish = (finished: PlayState) => {
    const current = stateRef.current;
    // 链：单次动作完成后播下一个（宠物 sleep_enter -> sleep_loop 等）
    if (finished.chain.length > 0) {
      play(finished.chain[0], finished.priority, finished.chain.slice(1));
      return;
    }
    // 队列里的更高优先动作优先于 returnTo
    if (current.queued) {
      play(current.queued, Math.max(current.priority, 10), []);
      return;
    }
    play(finished.returnTo ?? base, basePriority(finished.returnTo ?? base), []);
  };

  const cue = (action: string, options: CueOptions = {}) => {
    const priority = options.priority ?? 100;
    const chain = options.chain ?? [];
    const current = stateRef.current;
    // 循环基准（idle/sleep_loop/writing）可被任何指令打断；单次动作只能被更高优先级打断
    const canInterrupt = current.loop || priority >= current.priority;
    if (canInterrupt) {
      play(action, priority, chain);
      return;
    }
    // 单次动作进行中且新指令优先级更低：只保留一个更高优先的待播动作
    if (!current.queued) {
      apply({ ...current, queued: action });
    }
  };

  /** 强制立即设为某动作（场景切换等），不排队 */
  const setNow = (action: string) => {
    window.clearTimeout(timerRef.current);
    const descriptor = resolveAnimation(actor, action);
    apply({
      action,
      priority: basePriority(action),
      loop: descriptor.loop,
      returnTo: descriptor.returnTo,
      chain: [],
      queued: null,
    });
  };

  useEffect(
    () => () => window.clearTimeout(timerRef.current),
    [],
  );

  return {
    action: state.action as A,
    cue,
    setNow,
  };
}
