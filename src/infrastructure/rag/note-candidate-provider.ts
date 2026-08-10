/**
 * RAG 规则层候选来源
 *
 * ai 层定义 CandidateProvider 接口但不碰数据库（C2 依赖单向），
 * 这里用 SqliteNoteRepository 把它填上。
 *
 * 检索策略：优先用关键词命中缩小范围，只有在关键词没结果时才退到
 * 「拉最近一批 chunk」。反过来做（先全捞再过滤）在笔记攒到几千条以后
 * 会把整个库读进内存，而规则层的存在意义本来就是「便宜」。
 */
import type { CandidateProvider, RetrievalQuery, RuleCandidateSource } from '@ai/index';
import type { NoteChunk, SqliteNoteRepository } from '../db/repositories/note-repository';

/** 兜底扫描的上限。够覆盖近期笔记，又不至于把全库拉进内存 */
const FALLBACK_SCAN_LIMIT = 500;

/**
 * 提取用于 SQL LIKE 的关键词。
 *
 * 与 retrieval-strategy 的 extractKeywords 分开实现：那个是给打分用的，
 * 会切出大量 2 字中文滑窗，逐个查库太碎。这里只要几个「够长、够特别」
 * 的词把候选集缩小到能在内存里打分的规模。
 */
const searchTerms = (text: string, limit = 4): string[] => {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fa5]{3,}/g) ?? [];

  return [...new Set([...cjk, ...latin])]
    .sort((left, right) => right.length - left.length)
    .slice(0, limit);
};

export class NoteCandidateProvider implements CandidateProvider {
  constructor(private readonly notes: SqliteNoteRepository) {}

  async listCandidates(query: RetrievalQuery, limit: number): Promise<RuleCandidateSource[]> {
    const chunks = await this.collectChunks(query, limit);
    const excluded = new Set(query.excludeNoteIds ?? []);

    return chunks
      .filter((chunk) => !excluded.has(chunk.noteId))
      .slice(0, limit)
      .map(toCandidate);
  }

  private async collectChunks(query: RetrievalQuery, limit: number): Promise<NoteChunk[]> {
    const terms = searchTerms(query.text);

    if (terms.length === 0) {
      return this.notes.listChunksForRetrieval(Math.min(limit * 2, FALLBACK_SCAN_LIMIT));
    }

    // 每个词单独查，再按 chunkId 去重。一个 chunk 命中多个词是好事，
    // 这里不重复计数，权重交给 retrieval-strategy 统一打分
    const hits = await Promise.all(terms.map((term) => this.notes.searchChunks(term, limit)));
    const merged = new Map<string, NoteChunk>();
    for (const chunk of hits.flat()) {
      merged.set(chunk.id, chunk);
    }

    // 关键词一个都没命中时仍然给向量层留一批候选：
    // 用户搜「LoRA」但笔记里写的是「低秩适配」，字面匹配必然落空，
    // 这种情况恰恰是向量检索的主场，不该在规则层就把路堵死
    if (merged.size === 0) {
      return this.notes.listChunksForRetrieval(Math.min(limit * 2, FALLBACK_SCAN_LIMIT));
    }

    return [...merged.values()];
  }
}

const toCandidate = (chunk: NoteChunk): RuleCandidateSource => ({
  chunkId: chunk.id,
  noteId: chunk.noteId,
  text: chunk.text,
  tags: chunk.tags,
  // chunk 表没存 source_uri，同源加权由 tags 和文本相似度间接体现。
  // 为这点权重给每个 chunk 都 join 一次 notes 不值得
  createdDate: chunk.createdAt.slice(0, 10),
  // 父子块聚合：同一章节下的子块命中时合并成完整「父块」
  headingPath: chunk.headingPath,
});
