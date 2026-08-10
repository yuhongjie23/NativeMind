/**
 * ProcessLettersUseCase - 到点的信生成回信
 *
 * 找出 sendAfter 已过的 pending 信，逐封调 Flora agent 生成回信：
 * 原信标 sent，回信作为一条独立的 direction='in' 来信入「收到」栏。
 * 模型不可用 / 生成失败 → 留在 pending，下次再试（不丢信）。
 */
import type { FloraPort, LetterRepository } from '../../ports';
import { newId, now } from '../../shared/utils';

export class ProcessLettersUseCase {
  constructor(
    private readonly letterRepo: LetterRepository,
    private readonly flora: FloraPort
  ) {}

  async execute(): Promise<number> {
    const due = await this.letterRepo.listPendingDue(now());
    let processed = 0;

    for (const letter of due) {
      try {
        const result = await this.flora.sendLetter({
          letter: letter.letter,
          language: letter.language,
        });
        // 只有真的生成了回信才标 sent，否则留待下次重试
        if (!result.ok || !result.reply) continue;
        await this.letterRepo.save({
          ...letter,
          status: 'sent',
          sentAt: now(),
        });
        // 回信作为独立来信入「收到」栏（保持同一会话）
        await this.letterRepo.save({
          id: newId(),
          letter: result.reply,
          language: letter.language,
          direction: 'in',
          type: 'reply',
          sendAfter: now(),
          status: 'sent',
          emotion: result.emotion,
          createdAt: now(),
          conversationId: letter.conversationId,
        });
        processed += 1;
      } catch {
        // 模型不可用：留在 pending
      }
    }
    return processed;
  }
}
