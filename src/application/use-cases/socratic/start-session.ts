/**
 * StartSocraticSessionUseCase - 用户主动开启提问会话
 *
 * 专注期间拒绝开启：提问会话本身是一段需要投入的深度对话，
 * 这时开启等于用另一件事替换掉当前专注的那件事。
 * 判断放在这里而不是只让 UI 禁按钮 —— UI 可以被绕过，策略才是唯一裁决处。
 */
import type { UUID } from '@shared-types/common';
import type { EventBus } from '../../events/event-bus';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import type { SocraticRepository, SocraticSession } from '../../ports';
import { newId, now } from '../../shared/utils';

export class StartSocraticSessionUseCase {
  constructor(
    private readonly socraticRepo: SocraticRepository,
    private readonly eventBus: EventBus,
    private readonly focusPolicy: FocusModePolicy
  ) {}

  async execute(input: { topic: string; relatedNoteIds?: UUID[] }): Promise<SocraticSession> {
    if (!this.focusPolicy.canInterrupt('socratic_session')) {
      throw new Error('专注进行中，先完成或结束这次专注再开始提问');
    }

    const topic = input.topic.trim();
    if (!topic) throw new Error('提问主题不能为空');


    const timestamp = now();
    const session: SocraticSession = {
      id: newId(),
      topic,
      relatedNoteIds: input.relatedNoteIds ?? [],
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.socraticRepo.saveSession(session);

    await this.eventBus.publish({
      type: 'SocraticSessionStarted',
      sessionId: session.id,
      topic,
      timestamp,
    });

    return session;
  }
}
