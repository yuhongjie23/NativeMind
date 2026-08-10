/**
 * CompleteFocusUseCase - 完成专注，解除专注模式
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { FocusRepository, FocusSession } from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { minutesSince, now } from '../../shared/utils';

export class CompleteFocusUseCase {
  constructor(
    private readonly focusRepo: FocusRepository,
    private readonly eventBus: EventBus,
    private readonly focusPolicy: FocusModePolicy
  ) {}

  async execute(sessionId: UUID, notes?: string): Promise<FocusSession> {
    const session = await this.focusRepo.findById(sessionId);
    if (!session) throw new Error(`专注记录不存在: ${sessionId}`);
    if (session.status !== 'active') return session;

    const completedAt = now();
    const actualMinutes = Math.round(minutesSince(session.startedAt));
    const completed: FocusSession = {
      ...session,
      status: 'completed',
      completedAt,
      // 持久化实际时长：复盘/今日/陪伴统计用它（缺省回退计划值）
      actualMinutes,
      notes: notes ?? session.notes,
    };
    await this.focusRepo.save(completed);
    this.focusPolicy.deactivate();

    await this.eventBus.publish({
      type: 'FocusSessionCompleted',
      sessionId: completed.id,
      todoId: completed.todoId,
      actualMinutes,
      timestamp: completedAt,
    });

    return completed;
  }
}
