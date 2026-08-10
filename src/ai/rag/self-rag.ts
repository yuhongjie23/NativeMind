/**
 * Self-RAG 深度问答：生成时自我评判
 *
 * 流程：深度检索 → 生成草稿 → 自我评判（相关性 / 有据 / 幻觉风险 / 质量）→
 * 不达标则带评判意见重生成（maxRefine 次）→ 输出「答案 + 引用 + 置信度」。
 *
 * 只读：只产出答案与引用，不写库（C1）。模型不可用 / 超时 / 输出不合法
 * 一律降级到「最佳努力」并标记 ok=false，绝不阻塞检索结果展示（C3）。
 *
 * 评判模式仿 relation-judge：结构化输出过 Schema（qa-critic.v1）后，
 * 再按候选集做后置过滤（used_chunk_ids 可能编造）。超时仿 rerank 的 Promise.race。
 */
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';
import type { RAGOrchestrator } from './rag-orchestrator';
import type { RetrievalCandidate } from './retrieval-strategy';

/** 评判器结构化输出，字段与 qa-critic.v1.json 对应 */
export interface SelfCritique {
  /** 资料与问题相关程度，0-1 */
  relevance: number;
  /** 答案是否严格基于资料 */
  grounded: boolean;
  /** 是否存在编造 / 超出资料的内容 */
  hallucination_risk: boolean;
  /** 质量分 0-10 */
  quality: number;
  /** 实际用到的片段 id（调用方再按候选集校验） */
  used_chunk_ids: string[];
  /** 给重生成的一句改进意见 */
  critique: string;
}

export interface SelfRagResult {
  /** 模型生成是否成功。false 时 answer 是「最相关片段」最佳努力，UI 据此降级提示 */
  ok: boolean;
  answer: string;
  /** 引用的资料片段（与评判器 used_chunk_ids 对齐；评判失败时回退为全部候选） */
  citations: RetrievalCandidate[];
  /** 归一化置信度 0-1 */
  confidence: number;
  /** 评判器是否成功执行 */
  judged: boolean;
  /** 是否触发过重生成 */
  regenerated: boolean;
  /** 无相关笔记（answer 为空，UI 提示换问法） */
  empty: boolean;
  /** 评判意见，UI 低置信时可展示 */
  critique?: string;
}

export interface SelfRagOptions {
  /** 送入生成的候选上限 */
  maxCandidates: number;
  /** 单条候选的文本上限（提示词压缩） */
  candidateChars: number;
  /** 最多重生成次数 */
  maxRefine: number;
  /** 生成步骤超时 */
  generateTimeoutMs: number;
  /** 评判步骤超时 */
  criticTimeoutMs: number;
}

export const defaultSelfRagOptions: SelfRagOptions = {
  maxCandidates: 6,
  candidateChars: 500,
  maxRefine: 1,
  generateTimeoutMs: 20000,
  criticTimeoutMs: 10000,
};

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);

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

const GENERATE_SYSTEM =
  '你是本地知识库的学习助手。严格依据下方「参考资料」作答，回答准确、有条理、用中文。' +
  '如果资料不足以回答，就明确说「资料不足」，不要编造。直接给答案，不要提及「参考资料」本身。';

const CRITIC_SYSTEM =
  '你是严格的质量评审。判断下面的回答：1) 是否与问题相关；2) 是否严格基于参考资料' +
  '（引用了资料却断言资料没有的内容视为幻觉）；3) 质量如何。并列出回答实际用到的资料片段 id。' +
  '只输出 JSON，不要其它内容。';

export class SelfRag {
  constructor(
    private readonly router: ModelRouter,
    private readonly rag: RAGOrchestrator,
    private readonly options: SelfRagOptions = defaultSelfRagOptions
  ) {}

  /**
   * 深度问答主入口。深度检索默认开启：深度问答本身就走慢路径，
   * 让 Multi-Query + HyDE + 重排参与，换取更高召回。
   */
  async ask(
    query: string,
    opts?: {
      deep?: boolean;
      excludeNoteIds?: string[];
      /** reset=true 表示新一轮生成开始（精修稿），调用方应清空旧预览 */
      onToken?: (delta: string, reset?: boolean) => void;
    }
  ): Promise<SelfRagResult> {
    let candidates: RetrievalCandidate[];
    try {
      candidates = await this.rag.retrieve(
        { text: query, deep: opts?.deep ?? true, excludeNoteIds: opts?.excludeNoteIds },
        this.options.maxCandidates
      );
    } catch {
      // 深度检索失败（重排超时 / embedding / 模型不可用）：按头注释降级为「无引用尽力回答」，
      // 绝不打穿深度问答
      return {
        ok: false,
        answer: '',
        citations: [],
        confidence: 0,
        judged: false,
        regenerated: false,
        empty: true,
      };
    }
    if (candidates.length === 0) {
      return {
        ok: true,
        answer: '',
        citations: [],
        confidence: 0,
        judged: true,
        regenerated: false,
        empty: true,
      };
    }

    const context = this.formatContext(candidates);

    let draft = await this.generate(query, context, { onToken: opts?.onToken });
    if (!draft.ok) {
      // 模型不可用：给出最相关片段作最佳努力，UI 提示降级
      return {
        ok: false,
        answer: truncate(candidates[0].text, this.options.candidateChars),
        citations: candidates,
        confidence: 0,
        judged: false,
        regenerated: false,
        empty: false,
      };
    }

    let critique = await this.criticize(query, context, draft.text);
    let regenerated = false;

    // 不达标（评判成功且判为无据 / 有幻觉风险）→ 带意见重生成 → 再评判
    let attempt = 0;
    while (
      critique &&
      !this.acceptable(critique) &&
      attempt < this.options.maxRefine
    ) {
      // 精修稿会整体替换草稿：先发 reset 让 UI 清掉旧草稿的流式预览，再流新稿
      opts?.onToken?.('', true);
      const refined = await this.generate(query, context, {
        critique: critique.critique,
        onToken: opts?.onToken,
      });
      if (!refined.ok) break; // 重生成失败，保留首次草稿
      draft = refined;
      critique = await this.criticize(query, context, draft.text);
      attempt += 1;
      regenerated = true;
    }

    return {
      ok: true,
      answer: draft.text,
      citations: this.pickCitations(candidates, critique),
      confidence: critique ? this.confidenceOf(critique) : 0.5,
      judged: Boolean(critique),
      regenerated,
      empty: false,
      critique: critique?.critique,
    };
  }

  private acceptable(c: SelfCritique): boolean {
    return c.grounded && !c.hallucination_risk;
  }

  private confidenceOf(c: SelfCritique): number {
    return clamp01(c.relevance * 0.6 + (c.quality / 10) * 0.4);
  }

  private pickCitations(
    candidates: RetrievalCandidate[],
    critique?: SelfCritique
  ): RetrievalCandidate[] {
    if (!critique) return candidates;
    const used = new Set(critique.used_chunk_ids ?? []);
    if (used.size === 0) return candidates;
    const cited = candidates.filter((c) => used.has(c.chunkId));
    return cited.length > 0 ? cited : candidates;
  }

  private formatContext(candidates: RetrievalCandidate[]): string {
    return candidates
      .map((c, index) => {
        const heading =
          c.headingPath && c.headingPath.length > 0 ? `《${c.headingPath.join(' / ')}》` : '';
        return `${index + 1}. [${c.chunkId}]${heading}\n   ${truncate(c.text, this.options.candidateChars)}`;
      })
      .join('\n');
  }

  private async generate(
    query: string,
    context: string,
    opts?: { critique?: string; onToken?: (delta: string) => void }
  ): Promise<{ ok: boolean; text: string }> {
    try {
      const result = await withTimeout(
        this.router.run<{ question: string; context: string }, string>({
          taskType: 'deep_qa_generate',
          input: { question: query, context },
          onToken: opts?.onToken,
          inlinePrompt: {
            system: GENERATE_SYSTEM,
            user: opts?.critique
              ? `上一版回答的问题：${opts.critique}\n请据此修正，仍然严格依据资料回答。\n\n问题：${query}\n\n参考资料：\n${context}`
              : `问题：${query}\n\n参考资料：\n${context}\n\n请依据资料回答。`,
          },
        }),
        this.options.generateTimeoutMs,
        '生成回答'
      );
      if (!result.ok || !result.output || !result.output.trim()) return { ok: false, text: '' };
      return { ok: true, text: result.output.trim() };
    } catch (error) {
      console.warn('[SelfRag] 生成失败，降级为资料摘要:', error);
      return { ok: false, text: '' };
    }
  }

  private async criticize(
    query: string,
    context: string,
    draft: string
  ): Promise<SelfCritique | undefined> {
    try {
      const result = await withTimeout(
        this.router.run<{ question: string; context: string; draft: string }, SelfCritique>({
          taskType: 'deep_qa_critic',
          input: { question: query, context, draft },
          inlinePrompt: {
            system: CRITIC_SYSTEM,
            user: `问题：${query}\n\n参考资料：\n${context}\n\n回答草稿：\n${truncate(draft, 2000)}\n\n请给出评判 JSON。`,
          },
        }),
        this.options.criticTimeoutMs,
        '评判回答'
      );
      if (!result.ok || !result.output) return undefined;
      return result.output;
    } catch (error) {
      console.warn('[SelfRag] 评判失败，接受当前草稿:', error);
      return undefined;
    }
  }
}
