/**
 * AbandonSocraticSessionUseCase - 中途放弃一次提问会话
 *
 * 放弃不是失败，不该带惩罚感：会话记录整条保留，用户随时能回看
 * 已经答过的部分。这也是后续判断「问题生成质量」的数据来源 ——
 * 如果大量会话在第一轮就被放弃，说明问题问得不好。
 */
import type { UUID } from '@shared-types/common';
import type { SocraticRepository, SocraticSession } from '../../ports';
import { now } from '../../shared/utils';

export class AbandonSocraticSessionUseCase {
  constructor(private readonly socraticRepo: SocraticRepository) {}

  async execute(sessionId: UUID): Promise<SocraticSession> {
    const session = await this.socraticRepo.findSession(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);

    // 幂等，且已完成的会话不该被改成放弃：那会丢掉一次有效对话的记录
    if (session.status === 'abandoned') return session;
    if (session.status === 'completed') {
      throw new Error('会话已完成，不能再标记为放弃');
    }

    const abandoned: SocraticSession = {
      ...session,
      status: 'abandoned',
      updatedAt: now(),
    };
    await this.socraticRepo.saveSession(abandoned);

    return abandoned;
  }
}
