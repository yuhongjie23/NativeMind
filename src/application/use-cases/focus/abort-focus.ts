/**
 * AbortFocusUseCase - 中断专注
 * 同一任务累计中断达到阈值时，额外发布 TaskRepeatedlyAborted。
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { FocusRepository, FocusSession } from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { minutesSince, now } from '../../shared/utils';

const REPEATED_ABORT_THRESHOLD = 3;

export class AbortFocusUseCase {
  constructor(
    private readonly focusRepo: FocusRepository,
    private readonly eventBus: EventBus,
    private readonly focusPolicy: FocusModePolicy
  ) {}

  async execute(sessionId: UUID, reason?: string): Promise<FocusSession> {
    const session = await this.focusRepo.findById(sessionId);
    if (!session) throw new Error(`专注记录不存在: ${sessionId}`);
    if (session.status !== 'active') return session;

    const abortedAt = now();
    const elapsedMinutes = Math.round(minutesSince(session.startedAt));
    const aborted: FocusSession = {
      ...session,
      status: 'aborted',
      abortedAt,
      abortReason: reason,
    };
    await this.focusRepo.save(aborted);
    this.focusPolicy.deactivate();

    await this.eventBus.publish({
      type: 'FocusSessionAborted',
      sessionId: aborted.id,
      todoId: aborted.todoId,
      elapsedMinutes,
      reason,
      timestamp: abortedAt,
    });

    if (aborted.todoId) {
      const abortCount = await this.focusRepo.countAbortsByTodo(aborted.todoId);
      if (abortCount >= REPEATED_ABORT_THRESHOLD) {
        await this.eventBus.publish({
          type: 'TaskRepeatedlyAborted',
          todoId: aborted.todoId,
          abortCount,
          timestamp: abortedAt,
        });
      }
    }

    return aborted;
  }
}
