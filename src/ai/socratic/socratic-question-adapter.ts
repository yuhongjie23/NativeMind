import type { GenerationOptions, SocraticExchange, SocraticQuestionPort } from '@application/ports';
import type { RAGOrchestrator } from '../rag/rag-orchestrator';
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';
import { firstSocraticQuestion } from './first-question';

/** Keep model availability failures distinct from user cancellation. */
export class ModelUnavailableError extends Error {
  constructor(feature: string, reason = '未找到可用模型，请在设置中检查模型状态') {
    super(`${feature}暂未生成：${reason}`);
    this.name = 'ModelUnavailableError';
  }
}

/* ---------- 苏格拉底提问 ---------- */

const MAX_HISTORY_TURNS = 6;

const formatHistory = (history: SocraticExchange[]): string => {
  if (history.length === 0) return '（这是第一轮）';
  return history
    .slice(-MAX_HISTORY_TURNS)
    .map((e) => `Q${e.turnNumber}: ${truncate(e.question, 200)}\nA${e.turnNumber}: ${e.userResponse ? truncate(e.userResponse, 500) : '（未回答）'}`)
    .join('\n');
};

export class SocraticQuestionAdapter implements SocraticQuestionPort {
  constructor(
    private readonly router: ModelRouter,
    private readonly rag?: RAGOrchestrator
  ) {}

  async askQuestion(input: {
    topic: string;
    history: SocraticExchange[];
  }, options?: GenerationOptions): Promise<{ question: string; feedback?: string }> {
    const last = input.history[input.history.length - 1];
    const relatedNotes = await this.collectRelatedNotes(input.topic, options?.signal);
    let streamed = '';
    let visible = '';

    const result = await this.router.run<typeof input, string>({
      taskType: 'socratic_question',
      modelPolicy: { maxTokens: 256 },
      signal: options?.signal,
      onToken: options?.onToken ? (delta, reset) => {
        if (reset) { streamed = ''; visible = ''; options.onToken?.('', true); }
        streamed += delta;
        const next = firstSocraticQuestion(streamed);
        if (next.length > visible.length) options.onToken?.(next.slice(visible.length));
        visible = next;
      } : undefined,
      input,
      promptVars: {
        topic: input.topic,
        history: formatHistory(input.history),
        relatedNotes: relatedNotes || '（无）',
        // fillTemplate 只替换 {{word}}，不支持 Mustache 条件块：把「先回应上一轮再提问」
        // 的完整指令直接作为 feedbackHint 值传进去，避免模板里出现没被替换的字面量
        feedbackHint: last?.userResponse
          ? '仅在上一轮回答包含相关学习内容时，简短回应其中一个具体观点，再提出一个问题；无关内容不回应、不引用，直接依据此前有效学习内容提问（总共不超过 100 字）。'
          : '直接提出下一个要讨论的问题（总共不超过 100 字）。',
      },
    });

    // 这是交互式功能，没有合理的兜底内容，交由 UI 提示降级
    const question = result.ok ? result.output?.trim() : undefined;
    if (!question) {
      const reason = result.error?.kind === 'model_unavailable' ? undefined
        : result.error?.message.includes('空内容') ? '模型返回了空内容，请重试'
        : result.error?.kind === 'model_error'
          ? /abort|timeout|超时|中断/i.test(result.error.message)
            ? '模型请求超时，请检查服务负载后重试'
            : '模型调用失败，请检查服务连接后重试'
          : '模型返回了空内容，请重试';
      throw new ModelUnavailableError('苏格拉底式提问', reason);
    }
    return { question: firstSocraticQuestion(question).trim() };
  }

  private async collectRelatedNotes(topic: string, signal?: AbortSignal): Promise<string> {
    if (!this.rag) return '';
    try {
      const candidates = await this.rag.retrieve({ text: topic, signal }, 3);
      return candidates.map((c) => `- ${truncate(c.text, 200)}`).join('\n');
    } catch (error) {
      signal?.throwIfAborted();
      console.warn('[SocraticQuestionAdapter] 检索相关笔记失败，跳过:', error);
      return '';
    }
  }
}
