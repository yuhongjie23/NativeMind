/**
 * WriteLetterUseCase - 写一封信给 Flora（实时回信）
 *
 * 写信后立即调用 Flora agent 生成回信：原信标 sent，回信作为一条独立的
 * direction='in' 来信入「收到」栏（不是挂在原信 reply 字段上）。
 * 模型不可用才留 pending（由 ProcessLettersUseCase 补发）。
 */
import type { FloraPort, Letter, LetterLanguage, LetterRepository } from '../../ports';
import { newId, now } from '../../shared/utils';

export class WriteLetterUseCase {
  constructor(
    private readonly letterRepo: LetterRepository,
    private readonly flora: FloraPort
  ) {}

  /**
   * 发一条消息给 Flora。conversationId 提供则续进该段对话；不提供则新开一段。
   * 回信（独立来信）与消息共享同一会话 id。
   */
  async execute(letter: string, language: LetterLanguage, conversationId?: string): Promise<Letter> {
    const trimmed = letter.trim();
    if (!trimmed) throw new Error('信件内容不能为空');

    const sessionId = conversationId ?? newId();
    const createdAt = now();
    const base: Letter = {
      id: newId(),
      letter: trimmed,
      language,
      direction: 'out',
      type: 'warm',
      sendAfter: createdAt,
      status: 'pending',
      createdAt,
      conversationId: sessionId,
    };

    let result: Awaited<ReturnType<FloraPort['sendLetter']>>;
    try {
      result = await this.flora.sendLetter({ letter: trimmed, language });
    } catch {
      // 模型不可用/超时/报错：先落 pending，由 ProcessLettersUseCase 稍后补发，
      // 用户写的内容不能因为生成回信失败而整封信丢掉
      await this.letterRepo.save(base);
      return base;
    }
    const replied = Boolean(result.ok && result.reply);
    // 回信是独立来信：原信只标 sent，reply 字段不再内联（旧数据除外）
    const record: Letter = replied ? { ...base, status: 'sent', sentAt: now() } : base;

    await this.letterRepo.save(record);
    if (replied) {
      await this.letterRepo.save({
        id: newId(),
        letter: result.reply,
        language,
        direction: 'in',
        type: 'reply',
        sendAfter: now(),
        status: 'sent',
        emotion: result.emotion,
        createdAt: now(),
        conversationId: sessionId,
      });
    }
    return record;
  }
}
