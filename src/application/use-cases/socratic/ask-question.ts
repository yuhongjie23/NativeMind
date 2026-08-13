/**
 * AskSocraticQuestionUseCase - 推进一轮提问
 * 记录用户上一轮回答，再生成下一个问题。
 */
import type { UUID } from '@shared-types/common';
import type { SocraticExchange, SocraticQuestionPort, SocraticRepository } from '../../ports';
import { newId, now } from '../../shared/utils';

export interface AskQuestionInput {
  sessionId: UUID;
  /** 用户对上一轮问题的回答 */
  previousResponse?: string;
}

export class AskSocraticQuestionUseCase {
  constructor(
    private readonly socraticRepo: SocraticRepository,
    private readonly questionPort: SocraticQuestionPort
  ) {}

  async execute(input: AskQuestionInput): Promise<SocraticExchange> {
    const session = await this.socraticRepo.findSession(input.sessionId);
    if (!session) throw new Error(`会话不存在: ${input.sessionId}`);
    if (session.status !== 'active') throw new Error('会话已结束');

    const history = await this.socraticRepo.listExchanges(session.id);

    // 先补上一轮的回答
    const last = history[history.length - 1];
    if (input.previousResponse && last && !last.userResponse) {
      const answered: SocraticExchange = { ...last, userResponse: input.previousResponse };
      await this.socraticRepo.saveExchange(answered);
      history[history.length - 1] = answered;
    }

    const { question, feedback } = await this.questionPort.askQuestion({
      topic: session.topic,
      history,
    });

    const exchange: SocraticExchange = {
      id: newId(),
      sessionId: session.id,
      turnNumber: history.length + 1,
      question,
      aiFeedback: feedback,
      createdAt: now(),
    };
    await this.socraticRepo.saveExchange(exchange);
    await this.socraticRepo.saveSession({ ...session, updatedAt: now() });

    return exchange;
  }
}
