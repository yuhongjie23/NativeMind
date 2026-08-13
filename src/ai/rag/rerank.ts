/**
 * 模型级重排（Rerank）
 *
 * 启发式（向量+关键词）召回一批候选后，用模型对每个候选按「与查询的相关性」打分，
 * 重新排序取 top-k。深度检索专用：模型不可用 / 超时 / 输出不合法一律回退原顺序，
 * 绝不阻塞检索。
 */
import type { ModelRouter } from '../router/model-router';
import { truncate } from '../shared/utils';
import type { RetrievalCandidate } from './retrieval-strategy';

export interface ReRankOptions {
  /** 最多重排多少个候选（先启发式截断，避免模型上下文爆掉） */
  maxCandidates: number;
  /** 单条候选送入模型的文本上限（提示词压缩） */
  candidateChars: number;
  timeoutMs: number;
}

export const defaultReRankOptions: ReRankOptions = {
  maxCandidates: 20,
  candidateChars: 300,
  timeoutMs: 4000,
};

interface ScoredId {
  id: string;
  score: number;
}

const SCORE_RE = /"id"\s*:\s*"([^"]+)"[^}]*?"score"\s*:\s*([0-9.]+)/g;

/** 宽松解析模型输出的 [{"id":"c1","score":8}]；容忍缺失/顺序乱 */
export function parseReRankOutput(raw: string): Map<string, number> {
  const map = new Map<string, number>();
  const text = raw
    .replace(/```/g, '')
    .replace(/^```json|^```/g, '')
    .trim();
  // 先试严格 JSON 数组
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item.id === 'string' && typeof item.score === 'number') {
          map.set(item.id, item.score);
        }
      }
      return map;
    }
  } catch {
    // 落到正则兜底
  }
  // 正则兜底：`"id":"c1","score":8`（容错常见格式错乱）
  let match = SCORE_RE.exec(text);
  while (match) {
    map.set(match[1], Number(match[2]));
    match = SCORE_RE.exec(text);
  }
  return map;
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    // 竞态一有结果就清掉定时器，否则败者 timer 空转保活事件循环
    const timer = setTimeout(() => reject(new Error('重排超时')), ms);
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

export class ReRanker {
  constructor(
    private readonly router: ModelRouter,
    private readonly options: ReRankOptions = defaultReRankOptions
  ) {}

  /** 对候选按相关性重排；失败/超时返回 null，调用方保持原顺序 */
  async rerank(
    query: string,
    candidates: RetrievalCandidate[],
    topK: number
  ): Promise<RetrievalCandidate[] | null> {
    const pool = candidates.slice(0, this.options.maxCandidates);
    if (pool.length < 2) return null;

    const list = pool
      .map(
        (c, index) =>
          `${index}. id: ${c.chunkId}\n   笔记: ${c.noteId}\n   内容: ${truncate(c.text, this.options.candidateChars)}`
      )
      .join('\n');

    const rankingPromise = this.router.run<{ query: string; candidates: string }, ScoredId[]>({
      taskType: 'search_result_ranking',
      input: { query, candidates: list },
      inlinePrompt: {
        system:
          '你是检索相关性排序器。给每个候选片段按与查询的相关性打分（0-10 分，10 最相关）。只输出 JSON 数组：[{"id":"候选id","score":分数}]，不要输出其它内容。',
        user: `查询：${query}\n\n候选片段：\n${list}\n\n请输出相关性分数 JSON。`,
      },
    });
    const result = await withTimeout(rankingPromise, this.options.timeoutMs).catch(() => null);
    // 重排超时/模型报错：保持启发式原顺序，绝不阻塞检索
    if (result === null) return null;

    // 优先用路由已解析的结构化输出；否则用原始文本宽松解析兜底
    let scores = new Map<string, number>();
    if (Array.isArray(result.output)) {
      for (const item of result.output) {
        if (item && typeof item.id === 'string' && typeof item.score === 'number') {
          scores.set(item.id, item.score);
        }
      }
    }
    if (scores.size === 0 && result.raw) scores = parseReRankOutput(result.raw);
    if (scores.size === 0) return null;

    const ranked = [...pool]
      .map((c) => ({ c, score: scores.get(c.chunkId) ?? -1 }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.c);
    return ranked.length > 0 ? ranked.slice(0, topK) : null;
  }
}
