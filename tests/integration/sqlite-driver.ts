/**
 * 用 Node 内置 SQLite（node:sqlite）实现的 SqlDriver。
 *
 * 集成测试在**真实 SQL 引擎**上跑完整迁移和仓储 CRUD，
 * 而不是像 memory-driver 那样按语句形状打桩 —— 索引、唯一约束、
 * UPSERT 这类行为只有真库才能验证。
 */
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlParam, SqlRow } from '@infrastructure/db/database';

export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    // 迁移里 note_chunks / focus_sessions 有外键，按真实库开启约束
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  async select(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    return this.db.prepare(sql).all(...params) as unknown as SqlRow[];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<number> {
    const result = this.db.prepare(sql).run(...params);
    return Number(result.changes);
  }

  async transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await work(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
