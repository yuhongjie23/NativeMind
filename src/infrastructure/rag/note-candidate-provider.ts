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
import type { KnowledgeLinkRepository } from '@application/ports';

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
  constructor(
    private readonly notes: SqliteNoteRepository,
    /** 知识链接仓储：检索时把「用户已确认的关联笔记」也纳入候选（显式关系 > 向量相似） */
    private readonly links?: KnowledgeLinkRepository
  ) {}

  async listCandidates(query: RetrievalQuery, limit: number): Promise<RuleCandidateSource[]> {
    const chunks = await this.collectChunks(query, limit);
    const excluded = new Set(query.excludeNoteIds ?? []);

    // 标题标注：给候选补上所属笔记标题（标题是强信号，UI 与模型判断都用得上）
    const titleById = await this.loadTitles(chunks.map((chunk) => chunk.noteId));

    return chunks
      .filter((chunk) => !excluded.has(chunk.noteId))
      .slice(0, limit)
      .map((chunk) => toCandidate(chunk, titleById.get(chunk.noteId)));
  }

  /**
   * 检索零命中时的兜底：拉最近一批笔记的 chunk 当候选（含标题）。
   * 用户导入一篇「记忆模块(Memory)」时，旧笔记正文可能一字不重叠——字面检索必然落空，
   * 但模型看标题 + 首段就能判断「记忆是 Agent 核心组件」这类语义关联。
   */
  async listFallback(query: RetrievalQuery, limit: number): Promise<RuleCandidateSource[]> {
    const excluded = new Set(query.excludeNoteIds ?? []);
    const chunks = await this.notes.listChunksForRetrieval(Math.min(limit * 3, FALLBACK_SCAN_LIMIT));
    const titleById = await this.loadTitles(chunks.map((chunk) => chunk.noteId));

    return chunks
      .filter((chunk) => !excluded.has(chunk.noteId))
      .slice(0, limit)
      .map((chunk) => toCandidate(chunk, titleById.get(chunk.noteId)));
  }

  /** 批量取笔记标题（chunk 表没存标题，一次查询避免 N 次 findById） */
  private async loadTitles(noteIds: string[]): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    const notes = await this.notes.findByIds([...new Set(noteIds)]);
    for (const note of notes) titles.set(note.id, note.title);
    return titles;
  }

  private async collectChunks(query: RetrievalQuery, limit: number): Promise<NoteChunk[]> {
    const terms = searchTerms(query.text);
    let chunks: NoteChunk[];

    if (terms.length === 0) {
      chunks = await this.notes.listChunksForRetrieval(Math.min(limit * 2, FALLBACK_SCAN_LIMIT));
    } else {
      // 每个词单独查，再按 chunkId 去重。一个 chunk 命中多个词是好事，
      // 这里不重复计数，权重交给 retrieval-strategy 统一打分
      const hits = await Promise.all(terms.map((term) => this.notes.searchChunks(term, limit)));
      const merged = new Map<string, NoteChunk>();
      for (const chunk of hits.flat()) {
        merged.set(chunk.id, chunk);
      }

      // 标题检索：正文零重叠但标题命中的笔记也要纳入（「记忆模块」vs「Agent 核心组件」）
      try {
        const titleNotes = await Promise.all(terms.map((term) => this.notes.findByTitleKeyword(term, 10)));
        for (const note of titleNotes.flat()) {
          const noteChunks = await this.notes.listChunksForNotes([note.id], limit);
          for (const chunk of noteChunks) merged.set(chunk.id, chunk);
        }
      } catch {
        // 标题检索失败不影响基础检索（C3）
      }

      // 关键词一个都没命中时仍然给向量层留一批候选：
      // 用户搜「LoRA」但笔记里写的是「低秩适配」，字面匹配必然落空，
      // 这种情况恰恰是向量检索的主场，不该在规则层就把路堵死
      if (merged.size === 0) {
        chunks = await this.notes.listChunksForRetrieval(Math.min(limit * 2, FALLBACK_SCAN_LIMIT));
      } else {
        chunks = [...merged.values()];
      }
    }

    // 标签检索增强：搜索词恰好是某篇笔记的标签时（正文可能不含该词），
    // 把标签命中的笔记 chunk 也纳入候选，让 scoreByRules 的标签分有机会起作用。
    // findByTags 用 JSON 数组元素级精确匹配，不会把「学习」误命中「深度学习」。
    if (terms.length > 0) {
      try {
        const tagNotes = await this.notes.findByTags([...(query.tags ?? []), ...terms], 20);
        if (tagNotes.length > 0) {
          const tagChunks = await this.notes.listChunksForNotes(
            tagNotes.map((note) => note.id)
          );
          const seen = new Set(chunks.map((chunk) => chunk.id));
          for (const chunk of tagChunks) {
            if (!seen.has(chunk.id)) chunks.push(chunk);
          }
        }
      } catch {
        // 标签检索失败不影响基础检索（C3）
      }
    }

    // 知识链接增强：已确认的关系比向量相似更可信。
    // 把命中笔记的「已确认邻接笔记」的 chunk 也纳入候选，让显式关系参与检索。
    if (this.links && chunks.length > 0) {
      try {
        const hitNoteIds = new Set(chunks.map((chunk) => chunk.noteId));
        const neighborIds = new Set<string>();
        for (const noteId of hitNoteIds) {
          const edges = await this.links.query({ entity: { type: 'note', id: noteId } });
          for (const edge of edges) {
            if (!edge.confirmedByUser || edge.archivedAt) continue;
            const otherId = edge.fromId === noteId ? edge.toId : edge.fromId;
            const otherType = edge.fromId === noteId ? edge.toType : edge.fromType;
            if (otherType === 'note' && !hitNoteIds.has(otherId)) neighborIds.add(otherId);
          }
        }
        if (neighborIds.size > 0) {
          const neighborChunks = await this.notes.listChunksForNotes([...neighborIds]);
          const seen = new Set(chunks.map((chunk) => chunk.id));
          for (const chunk of neighborChunks) {
            if (!seen.has(chunk.id)) chunks.push(chunk);
          }
        }
      } catch {
        // 链接增强失败不影响基础检索（C3）
      }
    }

    return chunks;
  }
}

const toCandidate = (chunk: NoteChunk, title?: string): RuleCandidateSource => ({
  chunkId: chunk.id,
  noteId: chunk.noteId,
  text: chunk.text,
  title,
  tags: chunk.tags,
  // chunk 表没存 source_uri，同源加权由 tags 和文本相似度间接体现。
  // 为这点权重给每个 chunk 都 join 一次 notes 不值得
  createdDate: chunk.createdAt.slice(0, 10),
  // 父子块聚合：同一章节下的子块命中时合并成完整「父块」
  headingPath: chunk.headingPath,
  // 段落在原笔记正文中的字符偏移，UI 点开结果时可定位到具体段落
  charStart: chunk.charStart,
});
