/**
 * Flora 写信 agent 链
 *
 * 三步编排：
 *   1. 低级模型通读来信 → 情感分析（情绪 / 摘要 / 建议语气，JSON）
 *   2. 高级模型按目标语言写回信（自由文本，deep tier）
 *   3. 低级模型验证回信（语气贴合 / 回应了内容 / 用了目标语言，JSON）
 *      → 不达标带意见重生成一次（maxRefine）
 *
 * 每一步失败都降级：情感分析失败则跳过分析直接回信；回信失败返回 ok=false；
 * 验证失败接受当前回信（verified 保持 true，避免因小模型抽风误杀好回信）。
 * 语言由调用方传入（设置里的中/英），回信语言据此。
 */
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';

export type FloraLanguage = 'zh' | 'en';

export interface EmotionAnalysis {
  /** 情绪标签，如 低落 / 兴奋（按目标语言） */
  emotion: string;
  summary: string;
  /** 回信建议语气 */
  tone: string;
}

export interface FloraResult {
  ok: boolean;
  emotion?: EmotionAnalysis;
  reply: string;
  verified: boolean;
  regenerated: boolean;
}

export interface FloraOptions {
  letterChars: number;
  replyTimeoutMs: number;
  maxRefine: number;
}

export const defaultFloraOptions: FloraOptions = {
  letterChars: 4000,
  replyTimeoutMs: 30000,
  maxRefine: 1,
};

const LANGUAGE_NAME: Record<FloraLanguage, string> = { zh: '中文', en: 'English' };
const LANGUAGE_HINT: Record<FloraLanguage, string> = {
  zh: '请用中文写回信。',
  en: 'Please write the reply in English.',
};

/** 回信落款日期（实时），按语言格式化 */
const formatLetterDate = (language: FloraLanguage, date = new Date()): string => {
  if (language === 'en') {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    // 竞态一有结果就清掉定时器，否则败者 timer 空转保活事件循环（最多可达 30s）
    const timer = setTimeout(() => reject(new Error(`${label}超时`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export class FloraAgent {
  constructor(
    private readonly router: ModelRouter,
    private readonly options: FloraOptions = defaultFloraOptions
  ) {}

  async sendLetter(letter: string, language: FloraLanguage): Promise<FloraResult> {
    const letterText = truncate(letter, this.options.letterChars);

    const emotion = await this.analyzeEmotion(letterText, language);
    if (!emotion) {
      // 情感分析失败：仍尽力回信，只是不附带分析
      const fallback = await this.writeReply(letterText, undefined, language);
      return fallback.ok
        ? { ok: true, reply: fallback.text, verified: true, regenerated: false }
        : { ok: false, reply: '', verified: false, regenerated: false };
    }

    let reply = await this.writeReply(letterText, emotion, language);
    if (!reply.ok) {
      return { ok: false, emotion, reply: '', verified: false, regenerated: false };
    }

    let verify = await this.verify(letterText, reply.text, language);
    let regenerated = false;
    // 低级模型验证不达标 → 带意见重生成一次 → 再验证
    if (verify && !verify.appropriate) {
      const refined = await this.writeReply(letterText, emotion, language, verify.critique);
      if (refined.ok) {
        reply = refined;
        regenerated = true;
        verify = await this.verify(letterText, reply.text, language);
      }
    }

    return {
      ok: true,
      emotion,
      reply: reply.text,
      verified: verify ? verify.appropriate : true,
      regenerated,
    };
  }

  private async analyzeEmotion(
    letter: string,
    language: FloraLanguage
  ): Promise<EmotionAnalysis | undefined> {
    try {
      const result = await withTimeout(
        this.router.run<{ letter: string; language: string }, EmotionAnalysis>({
          taskType: 'letter_emotion',
          input: { letter, language },
          inlinePrompt: {
            system:
              '你是信件阅读助手。把来信完整读一遍，分析写信人的情绪，给出回信语气建议。' +
              `使用${LANGUAGE_NAME[language]}输出 summary 与 tone。只输出 JSON。`,
            user: `来信：\n${letter}`,
          },
        }),
        15000,
        '分析来信'
      );
      return result.ok && result.output ? result.output : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeReply(
    letter: string,
    emotion: EmotionAnalysis | undefined,
    language: FloraLanguage,
    critique?: string
  ): Promise<{ ok: boolean; text: string }> {
    try {
      const result = await withTimeout(
        this.router.run<{ letter: string; language: string }, string>({
          taskType: 'letter_reply',
          input: { letter, language },
          inlinePrompt: {
            system:
              `你是 Flora，一位温柔、真诚、有洞察力的笔友。认真读完来信，体察写信人的情绪，` +
              `用合适的语气回一封温暖的信。${LANGUAGE_HINT[language]}` +
              `回信以固定称呼「dear love」开头，然后正文。不要评价「你的来信」，直接开始。` +
              `不要在正文里写日期（日期由程序自动落款）。`,
            user: emotion
              ? `来信情绪分析：情绪=${emotion.emotion}；摘要=${emotion.summary}；建议语气=${emotion.tone}\n\n来信：\n${letter}` +
                (critique ? `\n\n上一版回信需要改进：${critique}` : '') +
                '\n\n请写回信。'
              : `来信：\n${letter}` +
                (critique ? `\n\n上一版回信需要改进：${critique}` : '') +
                '\n\n请写回信。',
          },
        }),
        this.options.replyTimeoutMs,
        '写回信'
      );
      if (!result.ok || !result.output || !result.output.trim()) return { ok: false, text: '' };
      // 落款追加实时日期（程序填，不用模型生成）
      return { ok: true, text: `${result.output.trim()}\n\n${formatLetterDate(language)}` };
    } catch {
      return { ok: false, text: '' };
    }
  }

  private async verify(
    letter: string,
    reply: string,
    language: FloraLanguage
  ): Promise<{ appropriate: boolean; critique: string } | undefined> {
    try {
      const result = await withTimeout(
        this.router.run<
          { letter: string; reply: string; language: string },
          { appropriate: boolean; critique: string }
        >({
          taskType: 'letter_verify',
          input: { letter, reply, language },
          inlinePrompt: {
            system:
              '你是回信质检员。检查回信是否：1) 语气贴合来信情绪、不冷漠不越界；2) 确实回应了来信内容；' +
              `3) 使用了${LANGUAGE_NAME[language]}。只输出 JSON。`,
            user: `来信：\n${letter}\n\n回信：\n${reply}`,
          },
        }),
        12000,
        '验证回信'
      );
      if (!result.ok || !result.output) return undefined;
      return result.output;
    } catch {
      return undefined;
    }
  }
}
