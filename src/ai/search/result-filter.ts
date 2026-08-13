/**
 * 搜索结果筛选（§11.4）
 *
 * 两步：
 *   1. 规则粗筛：去重、去低质、按时间与来源打分（便宜、可解释、不依赖模型）
 *   2. 模型精排（coach / 7B）：给出「为什么相关」的一句理由
 *
 * 模型不可用时只返回粗筛结果并标记 rankingSkipped，功能降级但不失效（§16.1）。
 * 展示形态是推荐阅读列表，不是长篇回答。
 */
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';

/** Provider 返回的原始结果（§14.2 只保留这几个字段） */
export interface RawSearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  site?: string;
}

export interface RankedResult extends RawSearchResult {
  /** 0-1 综合分 */
  score: number;
  /** 7B 给出的一句相关性理由，模型不可用时为空 */
  reason?: string;
}

/** 内容农场类站点，命中直接降权 */
const LOW_QUALITY_HINTS = ['csdn.net/download', 'baidu.com/link', 'zhuanlan.zhihu.com/write'];

const normalizeUrl = (url: string): string => url.replace(/[?#].*$/, '').replace(/\/+$/, '');

/** 提取主域名，用于同站限流 */
const hostOf = (url: string): string => {
  const match = url.match(/^https?:\/\/([^/]+)/i);
  return match ? match[1].toLowerCase() : '';
};

/** 规则打分：有摘要、时间新、来源可辨识加分；疑似低质降分 */
const scoreByRules = (result: RawSearchResult): number => {
  let score = 0.5;

  if (result.snippet && result.snippet.length > 40) score += 0.15;
  if (result.site) score += 0.05;

  if (result.publishedAt) {
    const months = (Date.now() - new Date(result.publishedAt).getTime()) / (30 * 86400000);
    if (Number.isFinite(months)) {
      if (months <= 12) score += 0.2;
      else if (months <= 36) score += 0.1;
      else score -= 0.1;
    }
  }

  if (LOW_QUALITY_HINTS.some((hint) => result.url.includes(hint))) score -= 0.3;

  return Math.max(0, Math.min(1, score));
};

export interface FilterOptions {
  /** 同一站点最多保留几条，避免一个站霸榜 */
  maxPerHost: number;
  /** 进入模型精排的候选数 */
  rankCandidateLimit: number;
}

export const defaultFilterOptions: FilterOptions = { maxPerHost: 2, rankCandidateLimit: 10 };

/** 去重 + 同站限流 + 规则打分排序 */
export function coarseFilter(
  results: RawSearchResult[],
  options: FilterOptions = defaultFilterOptions
): RankedResult[] {
  const seen = new Set<string>();
  const hostCount = new Map<string, number>();

  return results
    .filter((r) => r.title?.trim() && r.url?.trim())
    .map((r) => ({ ...r, score: scoreByRules(r) }))
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      const key = normalizeUrl(r.url);
      if (seen.has(key)) return false;

      const host = hostOf(r.url);
      const count = hostCount.get(host) ?? 0;
      if (count >= options.maxPerHost) return false;

      seen.add(key);
      hostCount.set(host, count + 1);
      return true;
    });
}

interface RankingItem {
  index: number;
  score: number;
  reason: string;
}

const RANK_SYSTEM = [
  '你在为一个学习者挑选阅读材料。',
  '只输出 JSON 数组，不解释。',
  'reason 一句话说明这条为什么值得读，不超过 40 字，不要复述标题。',
  '明显与主题无关的条目直接不要列出。',
].join('\n');

export class ResultFilter {
  constructor(
    private readonly router: ModelRouter,
    private readonly options: FilterOptions = defaultFilterOptions
  ) {}

  async refine(
    topic: string,
    raw: RawSearchResult[],
    limit: number
  ): Promise<{ results: RankedResult[]; rankingSkipped: boolean }> {
    const coarse = coarseFilter(raw, this.options).slice(0, this.options.rankCandidateLimit);
    if (coarse.length === 0) return { results: [], rankingSkipped: false };

    const listing = coarse
      .map(
        (r, i) =>
          `${i}. ${r.title}｜来源 ${r.site ?? hostOf(r.url)}｜${r.publishedAt ?? '时间未知'}\n   ${truncate(r.snippet ?? '', 160)}`
      )
      .join('\n');

    const result = await this.router.run<{ topic: string; count: number }, RankingItem[]>({
      taskType: 'search_result_ranking',
      input: { topic, count: coarse.length },
      inlinePrompt: {
        system: RANK_SYSTEM,
        user: `学习主题：${truncate(topic, 200)}\n\n候选：\n${listing}\n\n挑出最值得读的 ${limit} 条，输出如 [{"index":0,"score":0.9,"reason":"直接对比了两种方法的显存开销"}]`,
      },
    });

    if (!Array.isArray(result.output)) {
      return { results: coarse.slice(0, limit), rankingSkipped: true };
    }

    const ranked = result.output
      .filter((item) => coarse[item.index] !== undefined)
      .slice(0, limit)
      .map<RankedResult>((item) => ({
        ...coarse[item.index],
        // 规则分与模型分各半，避免模型单方面把低质结果捧上来
        score: (coarse[item.index].score + (item.score ?? 0.5)) / 2,
        reason: item.reason,
      }));

    if (ranked.length === 0) return { results: coarse.slice(0, limit), rankingSkipped: true };
    return { results: ranked.sort((a, b) => b.score - a.score), rankingSkipped: false };
  }
}
