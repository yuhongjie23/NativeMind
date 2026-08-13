/**
 * 深度问答历史 Repository
 *
 * citations 以 JSON 落库，读时还原结构。布尔字段用 0/1（toBoolColumn）。
 * 列表按 created_at 倒序 —— 历史问答是「回看」场景，最近的最优先。
 */
import type { AskSession, AskSessionRepository } from '@application/ports';
import type { UUID } from '@shared-types/common';
import {
  fromBoolColumn,
  fromJsonColumn,
  optionalText,
  readText,
  toBoolColumn,
  toJsonColumn,
  type Database,
  type SqlRow,
} from '../database';

const ASK_COLUMNS = `id, question, answer, citations, confidence, judged,
       regenerated, ok, empty, critique, created_at, updated_at`;

const toAskSession = (row: SqlRow): AskSession => ({
  id: String(row.id),
  question: String(row.question),
  answer: String(row.answer),
  citations: fromJsonColumn<AskSession['citations']>(row.citations, []),
  confidence: Number(row.confidence),
  judged: fromBoolColumn(row.judged),
  regenerated: fromBoolColumn(row.regenerated),
  ok: fromBoolColumn(row.ok),
  empty: fromBoolColumn(row.empty),
  critique: readText(row.critique),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class SqliteAskSessionRepository implements AskSessionRepository {
  constructor(private readonly db: Database) {}

  async save(session: AskSession): Promise<void> {
    await this.db.execute(
      `INSERT INTO ask_sessions (${ASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.question,
        session.answer,
        toJsonColumn(session.citations),
        session.confidence,
        toBoolColumn(session.judged),
        toBoolColumn(session.regenerated),
        toBoolColumn(session.ok),
        toBoolColumn(session.empty),
        optionalText(session.critique),
        session.createdAt,
        session.updatedAt,
      ]
    );
  }

  async list(limit = 50): Promise<AskSession[]> {
    const rows = await this.db.select(
      `SELECT ${ASK_COLUMNS} FROM ask_sessions ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toAskSession);
  }

  async delete(id: UUID): Promise<boolean> {
    const affected = await this.db.execute('DELETE FROM ask_sessions WHERE id = ?', [id]);
    return affected > 0;
  }
}
