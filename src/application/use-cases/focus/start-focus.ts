/**
 * StartFocusUseCase - 开始专注，同时激活专注模式
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { FocusRepository, FocusSession } from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { newId, now } from '../../shared/utils';

export interface StartFocusInput {
  todoId?: UUID;
  durationMinutes?: number;
}

export class StartFocusUseCase {
  constructor(
    private readonly focusRepo: FocusRepository,
    private readonly eventBus: EventBus,
    private readonly focusPolicy: FocusModePolicy
  ) {}

  async execute(input: StartFocusInput = {}): Promise<FocusSession> {
    const active = await this.focusRepo.findActive();
    if (active) throw new Error('已有进行中的专注，请先完成或中断');

    const durationMinutes = input.durationMinutes ?? 25;
    if (durationMinutes <= 0) throw new Error('专注时长必须大于 0');

    const startedAt = now();
    const session: FocusSession = {
      id: newId(),
      todoId: input.todoId,
      durationMinutes,
      startedAt,
      status: 'active',
    };
    await this.focusRepo.save(session);
    this.focusPolicy.activate(session.id);

    await this.eventBus.publish({
      type: 'FocusSessionStarted',
      sessionId: session.id,
      todoId: session.todoId,
      durationMinutes,
      timestamp: startedAt,
    });

    return session;
  }
}
