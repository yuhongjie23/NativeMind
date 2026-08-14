/**
 * SearchGate - 外部搜索门禁（§14）
 *
 * 这是唯一允许发起出站请求的地方。三道闸依次通过才放行：
 *   1. 触发场景合法（§14.1）
 *   2. 专注模式允许（C4，由 application 传入裁决结果）
 *   3. 隐私策略允许 + 用户确认（C6）
 *
 * 出站载荷只含关键词，不含笔记原文。结果默认临时保留，
 * 用户主动选择保存后才由 application 写库（§14.2）。
 */
import type { KeywordGenerator } from './keyword-generator';
import type { ResultFilter, RankedResult, RawSearchResult } from './result-filter';

/** 合法触发场景，其余一律拒绝（§14.1） */
export type SearchTrigger =
  | 'user_explicit'
  | 'local_insufficient_confirmed'
  | 'review_supplement';

/** Provider 搜索结果 + 可选失败/拦截原因（供 UI 展示，不静默空结果） */
export interface ProviderResult {
  results: RawSearchResult[];
  /** 无结果时的原因（反爬拦截/网络失败/解析失败），供 UI 提示用户 */
  reason?: string;
}

export interface SearchProvider {
  /** 只接收关键词。实现方不得附带任何本地内容 */
  search(query: string, limit: number): Promise<ProviderResult>;
}

/**
 * 门禁前置条件，由 application 层填好传入。
 * AI 层不自己读设置、不自己判断专注状态（C2 依赖单向）。
 */
export interface GateContext {
  trigger: SearchTrigger;
  /** FocusModePolicy.canInterrupt('external_search') 的结果 */
  focusAllows: boolean;
  /** PrivacyPolicy.canSearchExternally() 的结果 */
  privacyAllows: boolean;
  privacyReason?: string;
  /** 每次联网需确认时，用户是否已确认 */
  userConfirmed: boolean;
}

export type SearchDecision = { allowed: true } | { allowed: false; reason: string };

export interface SearchOutcome {
  allowed: boolean;
  reason?: string;
  results: RankedResult[];
  queries: string[];
  /** 关键词由本地规则兜底生成（模型不可用） */
  keywordFallback?: boolean;
  /** 语义排序未执行，结果只经过粗筛 */
  rankingSkipped?: boolean;
}

const VALID_TRIGGERS: SearchTrigger[] = [
  'user_explicit',
  'local_insufficient_confirmed',
  'review_supplement',
];

/** 纯函数裁决，便于单测与在 UI 上提前置灰按钮 */
export function evaluateGate(ctx: GateContext): SearchDecision {
  if (!VALID_TRIGGERS.includes(ctx.trigger)) {
    return { allowed: false, reason: '当前场景不允许发起外部搜索' };
  }
  if (!ctx.focusAllows) {
    return { allowed: false, reason: '专注模式进行中，外部搜索已推迟' };
  }
  if (!ctx.privacyAllows) {
    return { allowed: false, reason: ctx.privacyReason ?? '外部搜索已在设置中关闭' };
  }
  if (!ctx.userConfirmed) {
    return { allowed: false, reason: '需要用户确认后才能联网' };
  }
  return { allowed: true };
}

export interface SearchGateOptions {
  /** 每条检索式取多少候选 */
  perQueryLimit: number;
  /** 最终推荐给用户的条数（§11.4 推荐 3-5 条） */
  finalLimit: number;
}

export const defaultSearchGateOptions: SearchGateOptions = { perQueryLimit: 8, finalLimit: 5 };

export class SearchGate {
  /**
   * @param provider 固定实例，或每次搜索现取的工厂。
   *        工厂用于「用户在设置里切了引擎后无需重启生效」。
   */
  constructor(
    private readonly provider: SearchProvider | (() => SearchProvider),
    private readonly keywords: KeywordGenerator,
    private readonly filter: ResultFilter,
    private readonly options: SearchGateOptions = defaultSearchGateOptions
  ) {}

  private resolveProvider(): SearchProvider {
    return typeof this.provider === 'function' ? this.provider() : this.provider;
  }

  /**
   * @param topic 用户主题。调用方必须保证这里是主题描述，不是笔记原文（C6）
   * @param localGaps 本地资料的缺口描述，只能是关键词级别
   */
  async search(topic: string, ctx: GateContext, localGaps: string[] = []): Promise<SearchOutcome> {
    const decision = evaluateGate(ctx);
    if (!decision.allowed) {
      return { allowed: false, reason: decision.reason, results: [], queries: [] };
    }

    const { queries, fallback } = await this.keywords.generate(topic, localGaps);

    // 单条检索式失败不影响其余（外部服务本就不可靠）
    const provider = this.resolveProvider();
    const settled = await Promise.allSettled(
      queries.map((query) => provider.search(query, this.options.perQueryLimit))
    );

    const raw = settled.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? outcome.value.results : []
    );
    // 收集失败原因（第一个非空）：反爬拦截 / 网络失败，让 UI 明确告知而非「没有结果」
    const providerReason = settled
      .map((outcome) => (outcome.status === 'fulfilled' ? outcome.value.reason : undefined))
      .find((reason) => Boolean(reason));

    if (raw.length === 0) {
      return {
        allowed: true,
        reason:
          providerReason ??
          '外部搜索没有返回结果（引擎可能反爬拦截，可尝试切换引擎）',
        results: [],
        queries,
        keywordFallback: fallback,
      };
    }

    const { results, rankingSkipped } = await this.filter.refine(topic, raw, this.options.finalLimit);
    return { allowed: true, results, queries, keywordFallback: fallback, rankingSkipped };
  }
}
