/**
 * AskSocraticQuestionUseCase - 推进一轮提问
 * 记录用户上一轮回答，再生成下一个问题。
 */
import type { UUID } from '@shared-types/common';
import type { GenerationOptions, SocraticExchange, SocraticQuestionPort, SocraticRepository } from '../../ports';
import { abortable } from '../../shared/abortable';
import { newId, now } from '../../shared/utils';

export interface AskQuestionInput extends GenerationOptions {
  onCommit?: () => void;
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
    input.signal?.throwIfAborted();
    const session = await this.socraticRepo.findSession(input.sessionId);
    if (!session) throw new Error(`会话不存在: ${input.sessionId}`);
    if (session.status !== 'active') throw new Error('会话已结束');

    const history = await this.socraticRepo.listExchanges(session.id);
    input.signal?.throwIfAborted();

    // 先补上一轮的回答
    const last = history[history.length - 1];
    if (input.previousResponse && last && !last.userResponse) {
      const answered: SocraticExchange = { ...last, userResponse: input.previousResponse };
      await this.socraticRepo.saveExchange(answered);
      history[history.length - 1] = answered;
    }

    input.signal?.throwIfAborted();
    const { question, feedback } = await abortable(this.questionPort.askQuestion({
      topic: session.topic,
      history,
    }, input), input.signal);
    input.signal?.throwIfAborted();
    // A session may have been ended while the model was running.
    const current = await this.socraticRepo.findSession(session.id);
    input.signal?.throwIfAborted();
    if (!current || current.status !== 'active') throw new Error('会话已结束');

    const exchange: SocraticExchange = {
      id: newId(),
      sessionId: session.id,
      turnNumber: history.length + 1,
      question,
      aiFeedback: feedback,
      createdAt: now(),
    };
    input.onCommit?.();
    await this.socraticRepo.saveExchange(exchange);
    await this.socraticRepo.saveSession({ ...current, updatedAt: now() });

    return exchange;
  }
}
