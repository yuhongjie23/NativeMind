/**
 * SendLetterUseCase - 寄一封信给 Flora
 *
 * 空信短路；端口失败返回 ok=false 不向外抛（UI 据此提示模型不可用）。
 */
import type { FloraLanguage, FloraPort, FloraReply } from '../../ports';

export class SendLetterUseCase {
  constructor(private readonly flora: FloraPort) {}

  async execute(letter: string, language: FloraLanguage): Promise<FloraReply> {
    const trimmed = letter.trim();
    if (!trimmed) return { reply: '', verified: false, regenerated: false, ok: false };

    try {
      return await this.flora.sendLetter({ letter: trimmed, language });
    } catch (error) {
      console.warn('[SendLetterUseCase] Flora 写信失败:', error);
      return { reply: '', verified: false, regenerated: false, ok: false };
    }
  }
}
