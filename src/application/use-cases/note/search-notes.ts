/**
 * SearchNotesUseCase - 检索笔记（只读，不写库）
 * 本地检索始终可用；外部搜索需经 PrivacyPolicy 与专注模式裁决。
 *
 * 当本地结果不足（默认 < 3 条）且外部搜索可用时，自动触发外部搜索作为补充。
 * 外部搜索结果不落库，用户手动选择保存的才会写库。
 */
import type { NoteSearchPort, SearchHit } from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import type { PrivacyPolicy } from '../../policies/privacy-policy';
import type { RankedResult } from '@ai/search/result-filter';
import type { SearchGate, GateContext, SearchTrigger } from '@ai/search/search-gate';

export interface SearchNotesResult {
  hits: SearchHit[];
  /** 外部搜索结果（临时，不落库） */
  externalResults: RankedResult[];
  externalQueries: string[];
  externalSearchAttempted: boolean;
  externalSearchAvailable: boolean;
  externalBlockedReason?: string;
  /** 关键词走了本地规则兜底 */
  keywordFallback?: boolean;
  /** 外部搜索需要用户确认后再发起 */
  confirmationRequired: boolean;
  /** Self-RAG 信号：本地最高分命中仍偏低，提示结果可能不完整（建议深度检索/换词） */
  localLowConfidence?: boolean;
}

export class SearchNotesUseCase {
  constructor(
    private readonly noteSearch: NoteSearchPort,
    private readonly privacyPolicy: PrivacyPolicy,
    private readonly focusPolicy: FocusModePolicy,
    /** 不注入 = 外部搜索整体关闭 */
    private readonly searchGate?: SearchGate,
    /** 本地结果 >= 此数时跳过外部搜索 */
    private readonly localThreshold = 3
  ) {}

  async execute(
    query: string,
    limit = 10,
    trigger: SearchTrigger = 'user_explicit',
    deep?: boolean
  ): Promise<SearchNotesResult> {
    const keyword = query.trim();
    const empty = {
      hits: [] as SearchHit[],
      externalResults: [] as RankedResult[],
      externalQueries: [] as string[],
      externalSearchAttempted: false,
      externalSearchAvailable: false,
      confirmationRequired: false,
    };
    if (!keyword) return empty;

    const hits = await this.noteSearch.search(keyword, limit, deep);
    // Self-RAG 信号：最高分命中仍偏低 → 结果可能不完整
    const localLowConfidence = hits.length === 0 || hits[0].score < 0.4;

    // 专注中：不打扰，只给本地结果
    if (!this.focusPolicy.canInterrupt('external_search')) {
      return {
        ...empty,
        hits,
        localLowConfidence,
        externalSearchAvailable: false,
        externalBlockedReason: '专注模式进行中',
      };
    }

    const decision = this.privacyPolicy.canSearchExternally();
    if (!decision.allowed) {
      return {
        ...empty,
        hits,
        localLowConfidence,
        externalSearchAvailable: false,
        externalBlockedReason: decision.reason ?? '外部搜索已在设置中关闭',
      };
    }

    // 本地结果够了就不联网
    if (hits.length >= this.localThreshold) {
      return {
        ...empty,
        hits,
        localLowConfidence,
        externalSearchAvailable: true,
        externalSearchAttempted: false,
      };
    }

    // 没有接入外部搜索 provider
    if (!this.searchGate) {
      return {
        ...empty,
        hits,
        localLowConfidence,
        externalSearchAvailable: false,
        externalBlockedReason: '外部搜索未配置',
      };
    }

    // 需要用户确认
    if (decision.requiresConfirmation) {
      return {
        ...empty,
        hits,
        localLowConfidence,
        externalSearchAvailable: true,
        confirmationRequired: true,
      };
    }

    return this.performExternalSearch(keyword, hits, trigger);
  }

  /**
   * 用户确认后直接调这个方法，跳过确认步骤。
   * store 层显示确认弹窗 → 用户点「搜索」→ 调这个方法。
   */
  async executeWithConfirmation(
    query: string,
    trigger: SearchTrigger = 'user_explicit'
  ): Promise<SearchNotesResult> {
    const keyword = query.trim();
    const hits = await this.noteSearch.search(keyword, 10);

    if (!this.focusPolicy.canInterrupt('external_search')) {
      return {
        hits,
        externalResults: [],
        externalQueries: [],
        externalSearchAttempted: false,
        externalSearchAvailable: false,
        confirmationRequired: false,
        externalBlockedReason: '专注模式进行中',
      };
    }

    if (!this.searchGate) {
      return {
        hits,
        externalResults: [],
        externalQueries: [],
        externalSearchAttempted: false,
        externalSearchAvailable: false,
        confirmationRequired: false,
        externalBlockedReason: '外部搜索未配置',
      };
    }

    const privacyDecision = this.privacyPolicy.canSearchExternally();
    if (!privacyDecision.allowed) {
      return {
        hits,
        externalResults: [],
        externalQueries: [],
        externalSearchAttempted: false,
        externalSearchAvailable: false,
        confirmationRequired: false,
        externalBlockedReason: privacyDecision.reason,
      };
    }

    return this.performExternalSearch(keyword, hits, trigger);
  }

  private async performExternalSearch(
    keyword: string,
    hits: SearchHit[],
    trigger: SearchTrigger
  ): Promise<SearchNotesResult> {
    const gateCtx: GateContext = {
      trigger,
      focusAllows: this.focusPolicy.canInterrupt('external_search'),
      privacyAllows: this.privacyPolicy.canSearchExternally().allowed,
      userConfirmed: true,
    };

    const outcome = await this.searchGate!.search(keyword, gateCtx);

    return {
      hits,
      localLowConfidence: hits.length === 0 || hits[0].score < 0.4,
      externalResults: outcome.results,
      externalQueries: outcome.queries,
      externalSearchAttempted: outcome.allowed,
      externalSearchAvailable: true,
      // allowed=false（被拦）或「外部搜索发出但无结果且有原因」都提示用户；
      // 有结果时不打扰（reason 可能是「部分查询被拦」之类的次要信息）
      externalBlockedReason:
        outcome.allowed === false
          ? outcome.reason
          : outcome.results.length === 0 && outcome.reason
            ? outcome.reason
            : undefined,
      keywordFallback: outcome.keywordFallback,
      confirmationRequired: false,
    };
  }
}
