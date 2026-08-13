/**
 * NoteRepository 的 SQLite 实现，外加索引流水线需要的 chunk 读写
 *
 * 索引状态机（pending → parsing → chunking → indexing → indexed）由 Job 推进，
 * 这里只提供状态字段的读写和按状态捞待办笔记的查询。
 */
import type { Note, NotePageRange, NoteRepository, NoteSourceType } from '@application/ports';
import type { ISO8601DateTime, UUID } from '@shared-types/common';
import {
  fromJsonColumn,
  optionalNumber,
  optionalText,
  readNumber,
  readText,
  toJsonColumn,
  type Database,
  type SqlDriver,
  type SqlParam,
  type SqlRow,
} from '../database';

export type IndexStatus = Note['indexStatus'];

/** 笔记切片。text 是 embedding 与检索的输入单位 */
export interface NoteChunk {
  id: UUID;
  noteId: UUID;
  text: string;
  headingPath: string[];
  page?: number;
  charStart?: number;
  charEnd?: number;
  tags: string[];
  createdAt: ISO8601DateTime;
}

const COLUMNS = `id, title, content, content_hash, source_type, source_uri, index_status,
       embedding_version, chunk_count, indexed_at, index_error, tags, metadata,
       created_at, updated_at`;

const UPSERT = `
INSERT INTO notes (
  id, title, content, content_hash, source_type, source_uri, index_status,
  tags, metadata, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  content = excluded.content,
  content_hash = excluded.content_hash,
  source_type = excluded.source_type,
  source_uri = excluded.source_uri,
  index_status = excluded.index_status,
  tags = excluded.tags,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at`;

const CHUNK_COLUMNS = `id, note_id, text, heading_path, page, char_start, char_end, tags, created_at`;

const toNote = (row: SqlRow): Note => {
  const metadata = fromJsonColumn<{ pageRanges?: NotePageRange[] }>(row.metadata, {});
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    contentHash: String(row.content_hash),
    sourceType: String(row.source_type) as NoteSourceType,
    sourceUri: readText(row.source_uri),
    indexStatus: String(row.index_status) as IndexStatus,
    tags: fromJsonColumn<string[]>(row.tags, []),
    pageRanges: metadata.pageRanges,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
};

const toChunk = (row: SqlRow): NoteChunk => ({
  id: String(row.id),
  noteId: String(row.note_id),
  text: String(row.text),
  headingPath: fromJsonColumn<string[]>(row.heading_path, []),
  page: readNumber(row.page),
  charStart: readNumber(row.char_start),
  charEnd: readNumber(row.char_end),
  tags: fromJsonColumn<string[]>(row.tags, []),
  createdAt: String(row.created_at),
});

export class SqliteNoteRepository implements NoteRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UUID): Promise<Note | null> {
    const row = await this.db.selectOne(`SELECT ${COLUMNS} FROM notes WHERE id = ?`, [id]);
    return row ? toNote(row) : null;
  }

  /** 导入去重靠内容哈希：同一份 PDF 重复导入应该命中已有笔记 */
  async findByContentHash(hash: string): Promise<Note | null> {
    const row = await this.db.selectOne(`SELECT ${COLUMNS} FROM notes WHERE content_hash = ?`, [hash]);
    return row ? toNote(row) : null;
  }

  /**
   * 按标签查笔记：任一枚标签命中即返回（JSON 数组元素级精确匹配）。
   * 标签参与检索时用——用户搜的词恰好是某篇笔记的标签，即使正文没这个词也该找到。
   * `%"tag"%` 带引号避免子串误命中（如标签「学习」不能命中「深度学习」）。
   */
  async findByTags(tags: string[], limit = 20): Promise<Note[]> {
    if (tags.length === 0) return [];
    const clauses = tags
      .map(() => `tags LIKE ? ESCAPE '\\'`)
      .join(' OR ');
    // 转义 JSON 里的特殊字符：% _ \ 都要原义匹配
    const escapeLike = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const patterns = tags.map((tag) => `%"${escapeLike(tag)}"%`);
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM notes WHERE ${clauses} ORDER BY updated_at DESC LIMIT ?`,
      [...patterns, limit]
    );
    return rows.map(toNote);
  }

  /**
   * 按标题关键词查笔记：标题是强信号——正文用词不同但标题命中「记忆 / Memory」时，
   * 两篇明显相关的笔记（如「记忆模块」与「Agent 核心组件」）也能被召回。
   */
  async findByTitleKeyword(keyword: string, limit = 20): Promise<Note[]> {
    const clean = keyword.trim();
    if (!clean) return [];
    const escaped = clean.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM notes WHERE title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`,
      [`%${escaped}%`, limit]
    );
    return rows.map(toNote);
  }

  /** 按 id 批量取笔记（候选标题标注用） */
  async findByIds(ids: string[], limit = 100): Promise<Note[]> {
    const unique = [...new Set(ids)].slice(0, limit);
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => '?').join(',');
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM notes WHERE id IN (${placeholders})`,
      unique
    );
    return rows.map(toNote);
  }

  async save(note: Note): Promise<void> {
    const params: SqlParam[] = [
      note.id,
      note.title,
      note.content,
      note.contentHash,
      note.sourceType,
      optionalText(note.sourceUri),
      note.indexStatus,
      toJsonColumn(note.tags),
      note.pageRanges ? toJsonColumn({ pageRanges: note.pageRanges }) : null,
      note.createdAt,
      note.updatedAt,
    ];
    await this.db.execute(UPSERT, params);
  }

  async listAll(limit = 100): Promise<Note[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM notes ORDER BY updated_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toNote);
  }

  /** Job 调度器用它捞待处理的笔记，也用于启动时恢复中断的索引 */
  async findByIndexStatus(status: IndexStatus, limit = 20): Promise<Note[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM notes WHERE index_status = ? ORDER BY updated_at ASC LIMIT ?`,
      [status, limit]
    );
    return rows.map(toNote);
  }

  /**
   * 更新索引状态。失败时记下 index_error 供 UI 提示，
   * 成功时清空错误并落 indexed_at / embedding_version（版本升级时用来判断要不要重建）。
   */
  async updateIndexStatus(
    id: UUID,
    status: IndexStatus,
    detail: { error?: string; chunkCount?: number; embeddingVersion?: string } = {}
  ): Promise<void> {
    const indexedAt = status === 'indexed' ? new Date().toISOString() : null;
    await this.db.execute(
      `UPDATE notes SET
         index_status = ?,
         index_error = ?,
         chunk_count = COALESCE(?, chunk_count),
         embedding_version = COALESCE(?, embedding_version),
         indexed_at = COALESCE(?, indexed_at)
       WHERE id = ?`,
      [
        status,
        optionalText(detail.error),
        optionalNumber(detail.chunkCount),
        optionalText(detail.embeddingVersion),
        indexedAt,
        id,
      ]
    );
  }

  /** 内容变了要重新索引，先把旧 chunk 清掉再写新的，避免检索命中过期片段 */
  async replaceChunks(noteId: UUID, chunks: NoteChunk[]): Promise<void> {
    await this.db.transaction(async (tx: SqlDriver) => {
      await tx.execute('DELETE FROM note_chunks WHERE note_id = ?', [noteId]);
      for (const chunk of chunks) {
        await tx.execute(
          `INSERT INTO note_chunks (${CHUNK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            chunk.noteId,
            chunk.text,
            toJsonColumn(chunk.headingPath),
            optionalNumber(chunk.page),
            optionalNumber(chunk.charStart),
            optionalNumber(chunk.charEnd),
            toJsonColumn(chunk.tags),
            chunk.createdAt,
          ]
        );
      }
      await tx.execute('UPDATE notes SET chunk_count = ? WHERE id = ?', [chunks.length, noteId]);
    });
  }

  async listChunks(noteId: UUID): Promise<NoteChunk[]> {
    const rows = await this.db.select(
      `SELECT ${CHUNK_COLUMNS} FROM note_chunks WHERE note_id = ? ORDER BY char_start`,
      [noteId]
    );
    return rows.map(toChunk);
  }

  /** RAG 规则层的候选来源：给它标签和文本做关键词匹配 */
  async listChunksForRetrieval(limit = 500): Promise<NoteChunk[]> {
    const rows = await this.db.select(
      `SELECT ${CHUNK_COLUMNS} FROM note_chunks ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toChunk);
  }

  /** 指定若干笔记的全部 chunk（知识链接增强：把已确认邻接笔记纳入检索候选） */
  async listChunksForNotes(noteIds: string[], limit = 200): Promise<NoteChunk[]> {
    if (noteIds.length === 0) return [];
    const placeholders = noteIds.map(() => '?').join(',');
    const rows = await this.db.select(
      `SELECT ${CHUNK_COLUMNS} FROM note_chunks
       WHERE note_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      [...noteIds, limit]
    );
    return rows.map(toChunk);
  }

  /** 本地关键词检索（无向量库时的兜底，C3）。优先 FTS5，失败/无结果回退 LIKE。 */
  async searchChunks(keyword: string, limit = 10): Promise<NoteChunk[]> {
    const clean = keyword.trim();
    if (!clean) return [];

    // trigram 分词至少匹配 3 字符；把关键词拆成词/短语，用 OR 组合
    const ftsQuery = (clean.match(/[一-龥]+|[a-z0-9+#.-]+/gi) ?? [])
      .filter((token) => token.length >= 3)
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .join(' OR ');

    if (ftsQuery) {
      try {
        const rows = await this.db.select(
          `SELECT c.id, c.note_id, c.text, c.heading_path, c.page, c.char_start, c.char_end, c.tags, c.created_at
           FROM note_chunks_fts
           JOIN note_chunks c ON c.rowid = note_chunks_fts.rowid
           WHERE note_chunks_fts MATCH ?
           ORDER BY c.created_at DESC LIMIT ?`,
          [ftsQuery, limit]
        );
        if (rows.length > 0) return rows.map(toChunk);
        // 没命中不代表没有（可能关键词过短/停用），落到 LIKE 再试
      } catch {
        // FTS5 表不存在（旧库未迁移）→ 回退 LIKE
      }
    }

    // LIKE 兜底：转义 % _ \，否则用户输入的通配符会扩大匹配
    const escaped = clean.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const rows = await this.db.select(
      `SELECT ${CHUNK_COLUMNS} FROM note_chunks WHERE text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
      [`%${escaped}%`, limit]
    );
    return rows.map(toChunk);
  }

  async delete(id: UUID): Promise<void> {
    await this.db.transaction(async (tx: SqlDriver) => {
      await tx.execute('DELETE FROM note_chunks WHERE note_id = ?', [id]);
      await tx.execute('DELETE FROM notes WHERE id = ?', [id]);
    });
  }
}
