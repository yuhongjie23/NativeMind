/**
 * CompleteSocraticSessionUseCase - 正常结束一次提问会话
 *
 * 与 abandon 分成两个用例而不是一个带 status 参数的方法：
 * 「想清楚了」和「聊不下去了」是两种不同的结果，复盘时需要区分 ——
 * 大量 abandoned 说明问题生成得不好，而 completed 才是有效对话。
 * 合并成一个参数化方法会让调用点看不出语义差别。
 */
import type { UUID } from '@shared-types/common';
import type { SocraticRepository, SocraticSession } from '../../ports';
import { now } from '../../shared/utils';

export class CompleteSocraticSessionUseCase {
  constructor(private readonly socraticRepo: SocraticRepository) {}

  async execute(sessionId: UUID): Promise<SocraticSession> {
    const session = await this.socraticRepo.findSession(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);

    // 幂等：重复点「结束」不该报错，直接返回当前状态
    if (session.status === 'completed') return session;
    if (session.status === 'abandoned') {
      throw new Error('会话已放弃，不能再标记为完成');
    }

    const completed: SocraticSession = {
      ...session,
      status: 'completed',
      updatedAt: now(),
    };
    await this.socraticRepo.saveSession(completed);

    return completed;
  }
}
