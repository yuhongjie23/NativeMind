/**
 * sqlite-vec Provider（默认实现，本地优先）
 *
 * 向量和业务数据同库，不用额外起服务，这是首选方案。
 * 但 vec0 是可选扩展，用户环境未必装得上，所以 isAvailable 要真探一次，
 * 探不到就让 RAG 降级到关键词层（C3），而不是整个检索功能报废。
 */
import type { Database } from '../db/database';
import {
  distanceToScore,
  type VectorMatch,
  type VectorRecord,
  type VectorStoreProvider,
} from './vector-store-interface';

const TABLE = 'note_chunk_embeddings';

export class SqliteVecProvider implements VectorStoreProvider {
  readonly name = 'sqlite-vec';
  /** 缓存探测结果，避免每次检索都试建表 */
  private available: boolean | null = null;
  /** 本次会话是否因维度变化重建过向量库（装配层据此把 stale 笔记重新入队） */
  didRebuild = false;

  constructor(
    private readonly db: Database,
    // 默认 embedding 模型是 nomic-embed-text（768 维）。此前误配成 384 导致
    // upsert 永远维度不匹配、向量索引静默失败，这里对齐成 768
    readonly dimension = 768
  ) {}

  /** 建虚拟表。扩展没加载时这句会抛错，正好用来判断可用性。
   *  已存在但维度对不上（此前误建、或换了 embedding 模型）就重建——旧表里插不进数据，丢弃无损失。 */
  private async ensureTable(): Promise<void> {
    const row = await this.db.selectOne(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [TABLE]
    );
    if (row) {
      const declared = String(row.sql).match(/FLOAT\[(\d+)\]/);
      if (declared && Number(declared[1]) !== this.dimension) {
        // 维度变了（换 embedding 模型/配置）：旧向量与当前查询空间不兼容，只能重建。
        // DROP 后把「已 indexed」的笔记全部打回 stale，让流水线整体重嵌入——
        // 否则向量被静默清空、笔记仍假标 indexed，检索永远返回空。
        await this.db.execute(`DROP TABLE IF EXISTS ${TABLE}`);
        await this.db.execute(
          `UPDATE notes SET index_status = 'stale' WHERE index_status = 'indexed'`
        );
        this.didRebuild = true;
      }
    }

    await this.db.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLE} USING vec0(
         chunk_id TEXT PRIMARY KEY,
         note_id TEXT,
         embedding FLOAT[${this.dimension}]
       )`
    );
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      await this.ensureTable();
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    const mismatched = records.find((record) => record.embedding.length !== this.dimension);
    if (mismatched) {
      throw new Error(
        `向量维度不匹配：期望 ${this.dimension}，实际 ${mismatched.embedding.length}（chunk ${mismatched.chunkId}）`
      );
    }

    if (!(await this.isAvailable())) throw new Error('sqlite-vec 扩展不可用');

    await this.db.transaction(async (tx) => {
      for (const record of records) {
        // vec0 不支持 ON CONFLICT，重建走「先删后插」
        await tx.execute(`DELETE FROM ${TABLE} WHERE chunk_id = ?`, [record.chunkId]);
        await tx.execute(
          `INSERT INTO ${TABLE} (chunk_id, note_id, embedding) VALUES (?, ?, vec_f32(?))`,
          [record.chunkId, record.noteId, JSON.stringify(record.embedding)]
        );
      }
    });
  }

  /**
   * KNN 检索。text 不存在向量表里，需要 JOIN 回 note_chunks 取原文，
   * 这样上层拿到的 VectorMatch 是自洽的、可直接展示的。
   */
  async query(embedding: number[], limit: number): Promise<VectorMatch[]> {
    if (!(await this.isAvailable())) return [];

    const rows = await this.db.select(
      `SELECT e.chunk_id, e.note_id, c.text, e.distance
       FROM ${TABLE} e
       LEFT JOIN note_chunks c ON c.id = e.chunk_id
       WHERE e.embedding MATCH vec_f32(?) AND k = ?
       ORDER BY e.distance`,
      [JSON.stringify(embedding), limit]
    );

    return rows.map((row) => ({
      chunkId: String(row.chunk_id),
      noteId: String(row.note_id),
      text: row.text === null || row.text === undefined ? '' : String(row.text),
      score: distanceToScore(Number(row.distance)),
    }));
  }

  async deleteByNote(noteId: string): Promise<void> {
    if (!(await this.isAvailable())) return;
    await this.db.execute(`DELETE FROM ${TABLE} WHERE note_id = ?`, [noteId]);
  }

  async clear(): Promise<void> {
    if (!(await this.isAvailable())) return;
    await this.db.execute(`DELETE FROM ${TABLE}`);
  }
}
