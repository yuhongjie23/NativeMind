/**
 * 检索策略：规则层 + 向量层召回（§11.3 前两层）
 *
 * 规则层先跑的价值：便宜、可解释、可预测。向量层负责扩大召回。
 * 模型层（relation-judge）只在合并后的候选集上判断，不做全库扫描。
 */
import type { EmbeddingProvider, RerankProvider, VectorStorePort } from '../types';
import { expandQuery } from './query-expansion';
import type { QueryRewriter } from './query-rewriter';
import type { ReRanker } from './rerank';

export interface RetrievalCandidate {
  chunkId: string;
  noteId: string;
  text: string;
  /** 所属笔记标题：规则层从 SQLite 带上来，UI 展示与模型判断都用得上 */
  title?: string;
  /** 0-1，规则层与向量层加权后的综合分 */
  score: number;
  /** 命中来源，便于在 UI 上解释「为什么推荐这条」 */
  matchedBy: ('rule' | 'vector')[];
  /** 所属章节路径（父块上下文），如 ["大模型", "微调"] */
  headingPath?: string[];
  /** 段落在原笔记正文中的字符起始偏移（UI 定位用） */
  charStart?: number;
}

/** 规则层需要的最小元数据，由 application 层从 SQLite 取来传入 */
export interface RuleCandidateSource {
  chunkId: string;
  noteId: string;
  text: string;
  /** 所属笔记标题（标题是强检索信号，正文用词不同但标题命中也要能召回） */
  title?: string;
  tags: string[];
  createdDate?: string;
  sourceUri?: string;
  /** 所属章节路径（用于子块→父块聚合） */
  headingPath?: string[];
  /** 段落在原笔记正文中的字符起始偏移（UI 定位用） */
  charStart?: number;
}

export interface RetrievalQuery {
  text: string;
  tags?: string[];
  /** 同一天的任务/笔记更可能相关（§11.3 规则层） */
  date?: string;
  sourceUri?: string;
  /** 排除自己，避免新笔记和自己建链接 */
  excludeNoteIds?: string[];
  /** 深度检索：用 LLM 做 Multi-Query + HyDE（慢，用户显式开启） */
  deep?: boolean;
}

export interface RetrievalWeights {
  rule: number;
  vector: number;
  /** 低于此分的候选直接丢弃，减少模型层无效判断 */
  minScore: number;
}

export const defaultWeights: RetrievalWeights = { rule: 0.4, vector: 0.6, minScore: 0.18 };

/** 提取中英文关键词。中文按 2 字滑窗，够用且不引入分词库 */
export const extractKeywords = (text: string, limit = 12): string[] => {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];

  const bigrams = cjk.flatMap((run) =>
    run.length <= 4 ? [run] : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2))
  );

  return [...new Set([...latin, ...bigrams])].slice(0, limit);
};

/** 规则层打分：标签重合 + 关键词重合 + 关键词命中标签 + 同源 + 同日 */
const scoreByRules = (candidate: RuleCandidateSource, query: RetrievalQuery): number => {
  const queryTags = new Set(query.tags ?? []);
  const tagHits = candidate.tags.filter((tag) => queryTags.has(tag)).length;
  const tagScore = queryTags.size > 0 ? Math.min(tagHits / queryTags.size, 1) * 0.5 : 0;

  const keywords = extractKeywords(query.text);
  // 标题是强信号：正文用词不同但标题命中（如「记忆模块」vs「Agent 核心组件」），
  // 标题匹配算作更重的关键词命中——正文关键词权重 0.3，标题命中单个词直接给 0.5，
  // 保证「标题相关但正文零重叠」的笔记能单独过 minScore（0.18）。
  const titleLower = (candidate.title ?? '').toLowerCase();
  const titleHits = keywords.filter((kw) => titleLower.includes(kw)).length;
  // 标题是独立强信号：命中一个标题词即 0.5（×rule 权重 0.4 = 0.2 > minScore 0.18），
  // 「正文零重叠但标题相关」的笔记单靠标题就能被召回。
  const titleScore = titleHits > 0 ? Math.min(0.5 + (titleHits - 1) * 0.1, 0.8) : 0;

  const lower = candidate.text.toLowerCase();
  const keywordHits = keywords.filter((kw) => lower.includes(kw)).length;
  const keywordScore = keywords.length > 0 ? Math.min(keywordHits / keywords.length, 1) * 0.3 : 0;

  // 关键词命中候选标签：用户搜「微积分」而笔记正文没这词、但打了「微积分」标签，
  // 标签应该把这篇笔记抬上来（标签是用户自己给的内容摘要，比正文相似更可信）。
  // 权重与 query.tags 重合的 tagScore 一致（0.5），保证单靠标签分也能过 minScore。
  const tagLower = candidate.tags.map((tag) => tag.toLowerCase());
  const keywordTagHits = keywords.filter((kw) => tagLower.some((tag) => tag.includes(kw) || kw.includes(tag))).length;
  const keywordTagScore = keywords.length > 0 ? Math.min(keywordTagHits / keywords.length, 1) * 0.5 : 0;

  const sameSource = query.sourceUri && candidate.sourceUri === query.sourceUri ? 0.1 : 0;
  const sameDay = query.date && candidate.createdDate === query.date ? 0.1 : 0;

  return tagScore + keywordScore + titleScore + keywordTagScore + sameSource + sameDay;
};

export interface RetrievalOptions {
  /** 同一篇笔记最多贡献几个 chunk，防止大文件把别的笔记挤出结果（重排序/多样性） */
  maxChunksPerNote: number;
  /** 子块合并为父块时文本上限，避免整章塞爆后续 LLM 上下文 */
  maxParentChars: number;
  /**
   * 同一章节最多合并几个子块为一个父块。
   * 不加上限时，整篇挂同一标题的大文档（如整本电子书）会被并成一个巨型结果，
   * 检索退化成「整篇笔记」，用户无法定位到具体哪一段命中。
   */
  maxSiblingsPerHeading: number;
  /**
   * LLM 查询改写器（深度检索用，query.deep=true 时启用）：
   * 产出 Multi-Query 变体 + HyDE 假设性答案；失败/慢自动回退启发式。
   */
  queryRewriter?: QueryRewriter;
  /** 模型级重排（深度检索用）：对候选按相关性打分重排；失败/慢回退原顺序 */
  reranker?: ReRanker;
  /**
   * 专用 cross-encoder 重排（深度检索用，可选）：
   * 精度最高、无 prompt，有配置时优先用它；失败/慢回退生成式 reranker。
   */
  crossEncoder?: RerankProvider;
  /**
   * 模型级重排是否在普通检索（deep=false）也启用。
   * 默认 true：搜索关键词时同样让本地小模型按相关性评判段落并返回 top-k，
   * 避免只靠启发式分数把「整本书」的某个段落排前面；失败/超时自动回退原顺序。
   */
  rerankAlways?: boolean;
}

export const defaultRetrievalOptions: RetrievalOptions = {
  maxChunksPerNote: 3,
  maxParentChars: 2000,
  maxSiblingsPerHeading: 2,
  rerankAlways: true,
};

export class RetrievalStrategy {
  constructor(
    private readonly embedding: EmbeddingProvider,
    private readonly vectorStore: VectorStorePort,
    private readonly weights: RetrievalWeights = defaultWeights,
    options: Partial<RetrievalOptions> = {}
  ) {
    this.options = { ...defaultRetrievalOptions, ...options };
  }
  private readonly options: RetrievalOptions;

  /**
   * 合并两层召回。向量层失败（embedding 模型不可用）时退化为纯规则层，
   * 保证断网 / 模型缺失时检索仍然可用（C3、§16.1）。
   *
   * RAG 增强：先对查询做 Multi-Query / Sub-Query 展开，多角度召回后合并；
   * 合并时按「每篇笔记最多 maxChunksPerNote 个 chunk」做多样性重排（top-k），
   * 避免内容超长的单篇笔记把其它相关笔记挤出结果。
   */
  async retrieve(
    query: RetrievalQuery,
    ruleCandidates: RuleCandidateSource[],
    limit = 10
  ): Promise<RetrievalCandidate[]> {
    const excluded = new Set(query.excludeNoteIds ?? []);
    const merged = new Map<string, RetrievalCandidate>();

    // 查询展开：深度检索（LLM Multi-Query + HyDE）或启发式
    let variants = expandQuery(query.text);
    let hydePassage: string | undefined;
    if (query.deep && this.options.queryRewriter) {
      const rewritten = await this.options.queryRewriter.rewrite(query.text);
      variants = rewritten.variants;
      hydePassage = rewritten.hypothetical;
    }

    // 规则层：对每个查询变体分别打分，取该 chunk 的最优分
    ruleCandidates
      .filter((c) => !excluded.has(c.noteId))
      .forEach((c) => {
        let best = 0;
        for (const variant of variants) {
          best = Math.max(best, scoreByRules(c, { ...query, text: variant }));
        }
        const score = best * this.weights.rule;
        if (score <= 0) return;
        merged.set(c.chunkId, {
          chunkId: c.chunkId,
          noteId: c.noteId,
          text: c.text,
          title: c.title,
          score,
          matchedBy: ['rule'],
          headingPath: c.headingPath,
          charStart: c.charStart,
        });
      });

    try {
      // 向量层：把全部查询变体（+ HyDE 假设性答案）一起 embed，逐个查向量库，chunk 取各变体的最优分
      // 向量命中的 chunk 也要带标题：先从规则层候选建 noteId → title 反查表
      const titleByNote = new Map<string, string | undefined>();
      for (const c of ruleCandidates) {
        if (c.title) titleByNote.set(c.noteId, c.title);
      }
      const vectors = await this.embedding.embed(
        hydePassage ? [...variants, hydePassage] : variants
      );
      for (const vector of vectors) {
        const matches = await this.vectorStore.query(vector, limit * 2);
        matches
          .filter((m) => !excluded.has(m.noteId))
          .forEach((m) => {
            const weighted = m.score * this.weights.vector;
            const existing = merged.get(m.chunkId);
            if (existing) {
              if (weighted > existing.score) {
                existing.score = weighted;
                existing.matchedBy.push('vector');
              }
            } else {
              merged.set(m.chunkId, {
                chunkId: m.chunkId,
                noteId: m.noteId,
                text: m.text,
                title: titleByNote.get(m.noteId),
                score: weighted,
                matchedBy: ['vector'],
                charStart: m.charStart,
              });
            }
          });
      }
    } catch (error) {
      console.warn('[RetrievalStrategy] 向量召回失败，退化为规则层:', error);
    }

    // 先按分排序，再过滤低于阈值的
    const scored = [...merged.values()]
      .filter((c) => c.score >= this.weights.minScore)
      .sort((a, b) => b.score - a.score);

    // 子块→父块：同一章节（headingPath）下多个子块命中，合并成完整章节返回，
    // 兼顾精度与完整性。合并文本设上限，避免整章塞爆后续 LLM 上下文。
    let promoted = promoteSiblingChunks(
      scored,
      this.options.maxParentChars,
      this.options.maxSiblingsPerHeading
    );

    // 模型级 Rerank（深度检索或普通检索都启用，用本地小模型按相关性评判段落）：
    // 优先专用 cross-encoder（精度最高），失败/慢回退生成式 LLM 打分重排，
    // 两者都失败保持启发式顺序（C3）
    if (query.deep || this.options.rerankAlways) {
      let modelRanked: RetrievalCandidate[] | null = null;
      if (this.options.crossEncoder) {
        modelRanked = await this.rerankWithCrossEncoder(query.text, promoted);
      }
      if (!modelRanked && this.options.reranker) {
        modelRanked = await this.options.reranker.rerank(
          query.text,
          promoted,
          Math.max(limit, this.options.maxChunksPerNote * 4)
        );
      }
      if (modelRanked) promoted = modelRanked;
    }

    // 多样性重排 → 笔记轮询：按「每篇笔记最多 maxChunksPerNote 段」在各篇之间轮询，
    // 保证多篇命中笔记的段落都出现在结果里，而不是被高分单篇挤掉。
    // 轮询顺序：按笔记在 promoted 中的出现顺序（模型重排后 = 模型打分顺序）排序，
    // 而不是按 score 字段——rerank 只重排不更新 score，按 score 排会丢掉模型排序。
    const byNote = new Map<string, RetrievalCandidate[]>();
    for (const candidate of promoted) {
      const list = byNote.get(candidate.noteId);
      if (list) list.push(candidate);
      else byNote.set(candidate.noteId, [candidate]);
    }
    const noteQueues = [...byNote.values()].sort(
      (a, b) => promoted.indexOf(a[0]) - promoted.indexOf(b[0])
    );

    const diverse: RetrievalCandidate[] = [];
    for (let round = 0; round < this.options.maxChunksPerNote && diverse.length < limit; round += 1) {
      for (const queue of noteQueues) {
        const candidate = queue[round];
        if (!candidate) continue;
        diverse.push(candidate);
        if (diverse.length >= limit) break;
      }
    }
    return diverse;
  }

  /** cross-encoder 打分重排；失败/超时返回 null，调用方回退生成式重排 */
  private async rerankWithCrossEncoder(
    query: string,
    candidates: RetrievalCandidate[]
  ): Promise<RetrievalCandidate[] | null> {
    if (!this.options.crossEncoder || candidates.length < 2) return null;
    try {
      const scores = await this.options.crossEncoder.rerank(
        query,
        candidates.map((c) => c.text)
      );
      const ranked = candidates
        .map((c, index) => ({ c, score: scores[index] ?? -1 }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.c);
      return ranked.length > 0 ? ranked : null;
    } catch (error) {
      console.warn('[RetrievalStrategy] cross-encoder 重排失败，回退生成式重排:', error);
      return null;
    }
  }
}

/**
 * 同一章节的多个子块合并为「父块」；无章节或单子块保持原样。
 *
 * 合并按 maxSiblingsPerHeading 封顶：同一章节再多也只每 N 个子块出一段，
 * 避免整篇挂同一标题的大文档被并成一个巨型结果（用户就定位不到具体哪段命中了）。
 * 每篇笔记的封顶段数由调用方 maxChunksPerNote 再收一道。
 */
function promoteSiblingChunks(
  candidates: RetrievalCandidate[],
  maxParentChars: number,
  maxSiblingsPerHeading: number
): RetrievalCandidate[] {
  const groups = new Map<string, RetrievalCandidate[]>();
  for (const candidate of candidates) {
    const key =
      candidate.headingPath && candidate.headingPath.length > 0
        ? `${candidate.noteId}|${candidate.headingPath.join('/')}`
        : `single|${candidate.chunkId}`;
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }

  const out: RetrievalCandidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) {
      out.push(list[0]);
      continue;
    }
    for (let i = 0; i < list.length; i += maxSiblingsPerHeading) {
      const group = list.slice(i, i + maxSiblingsPerHeading);
      out.push({
        chunkId: group[0].chunkId,
        noteId: group[0].noteId,
        text: group
          .map((c) => c.text)
          .join('\n\n')
          .slice(0, maxParentChars),
        score: Math.max(...group.map((c) => c.score)),
        matchedBy: [...new Set(group.flatMap((c) => c.matchedBy))],
        headingPath: group[0].headingPath,
        charStart: group[0].charStart,
      });
    }
  }
  return out;
}
