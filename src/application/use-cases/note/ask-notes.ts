/**
 * AskNotesUseCase - 深度问答（Self-RAG）：检索 + 生成 + 自我评判
 *
 * 只读：不写库、不发事件（与 searchNotes 同属纯查询）。模型不可用时
 * 由 AI 层内部降级为「最相关片段」；本用例兜底端口抛错 → 空降级。
 */
import type { AskNotesAnswer, AskNotesPort } from '../../ports';

export const emptyAskNotesAnswer: AskNotesAnswer = {
  answer: '',
  citations: [],
  confidence: 0,
  judged: false,
  regenerated: false,
  empty: true,
  ok: false,
};

export class AskNotesUseCase {
  constructor(
    private readonly askNotes: AskNotesPort,
    /** 端口未注入或抛错时的兜底 */
    private readonly fallback: AskNotesAnswer = emptyAskNotesAnswer
  ) {}

  async execute(
    question: string,
    opts?: { deep?: boolean; onToken?: (delta: string, reset?: boolean) => void }
  ): Promise<AskNotesAnswer> {
    const trimmed = question.trim();
    if (!trimmed) return this.fallback;

    try {
      // 深度问答默认走深度检索（Multi-Query + HyDE + 重排）
      return await this.askNotes.ask({
        question: trimmed,
        deep: opts?.deep ?? true,
        onToken: opts?.onToken,
      });
    } catch (error) {
      console.warn('[AskNotesUseCase] 深度问答失败，返回空降级:', error);
      return this.fallback;
    }
  }
}
