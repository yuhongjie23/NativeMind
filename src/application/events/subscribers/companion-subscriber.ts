/**
 * 陪伴角色订阅者
 * 动画状态机切换 + 受策略约束的主动提问。
 */
import type { CompanionStateMachinePort } from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import type { TriggerInteractionUseCase } from '../../use-cases/companion/trigger-interaction';
import type { EventBus } from '../event-bus';

export function registerCompanionSubscriber(
  eventBus: EventBus,
  stateMachine: CompanionStateMachinePort,
  focusPolicy: FocusModePolicy,
  triggerInteraction: TriggerInteractionUseCase
): () => void {
  const unsubscribes = [
    eventBus.subscribe('AppEntered', async (event) => {
      if (!focusPolicy.canInterrupt('companion_dialogue')) return;
      await stateMachine.transition('enter', event);
    }),

    eventBus.subscribe('AppExiting', async (event) => {
      await stateMachine.transition('exit', event);
    }),

    // 专注开始：短暂鼓励后进入安静状态
    eventBus.subscribe('FocusSessionStarted', async (event) => {
      await stateMachine.transition('focus_start', event);
    }),

    eventBus.subscribe('FocusSessionCompleted', async (event) => {
      if (!focusPolicy.canInterrupt('companion_dialogue')) return;
      await stateMachine.transition('focus_complete', event);
      await triggerInteraction.execute({
        scene: 'focus_complete',
        triggerEvent: event.type,
      });
    }),

    eventBus.subscribe('FocusSessionAborted', async (event) => {
      if (!focusPolicy.canInterrupt('companion_dialogue')) return;
      await stateMachine.transition('focus_abort', event);
    }),

    eventBus.subscribe('TaskRepeatedlyAborted', async (event) => {
      if (!focusPolicy.canInterrupt('companion_dialogue')) return;
      await stateMachine.transition('encourage', event);
      await triggerInteraction.execute({
        scene: 'repeatedly_aborted',
        triggerEvent: event.type,
      });
    }),

    eventBus.subscribe('ReviewGenerated', async (event) => {
      if (!focusPolicy.canInterrupt('companion_dialogue')) return;
      await triggerInteraction.execute({
        scene: 'review_generated',
        triggerEvent: event.type,
      });
    }),
  ];

  return () => unsubscribes.forEach((off) => off());
}
