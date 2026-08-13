/**
 * ReviewRepository 的 SQLite 实现
 *
 * (review_type, date) 上有唯一索引，所以这里按这对键做 UPSERT：
 * 同一天重复生成复盘是覆盖，不是堆两份。
 */
import type { ReviewLog, ReviewRepository } from '@application/ports';
import {
  fromJsonColumn,
  optionalText,
  readText,
  toJsonColumn,
  type Database,
  type SqlParam,
  type SqlRow,
} from '../database';

const COLUMNS = `id, review_type, date, content, summary, statistics, insights,
       next_todos, source_proposal_id, created_at, updated_at`;

const UPSERT = `
INSERT INTO review_logs (
  id, review_type, date, content, summary, statistics, insights, next_todos,
  source_proposal_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(review_type, date) DO UPDATE SET
  content = excluded.content,
  summary = excluded.summary,
  statistics = excluded.statistics,
  insights = excluded.insights,
  next_todos = excluded.next_todos,
  source_proposal_id = excluded.source_proposal_id,
  updated_at = excluded.updated_at`;

const toReview = (row: SqlRow): ReviewLog => ({
  id: String(row.id),
  reviewType: String(row.review_type) as ReviewLog['reviewType'],
  date: String(row.date),
  content: String(row.content),
  summary: readText(row.summary),
  statistics: fromJsonColumn<Record<string, number>>(row.statistics, {}),
  insights: fromJsonColumn<string[]>(row.insights, []),
  nextTodos: fromJsonColumn<string[]>(row.next_todos, []),
  sourceProposalId: readText(row.source_proposal_id) || undefined,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class SqliteReviewRepository implements ReviewRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<ReviewLog | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM review_logs WHERE id = ?`,
      [id]
    );
    return row ? toReview(row) : null;
  }

  async findByDate(date: string, reviewType: 'daily' | 'weekly' | 'monthly'): Promise<ReviewLog | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM review_logs WHERE date = ? AND review_type = ?`,
      [date, reviewType]
    );
    return row ? toReview(row) : null;
  }

  async save(review: ReviewLog): Promise<void> {
    const params: SqlParam[] = [
      review.id,
      review.reviewType,
      review.date,
      review.content,
      optionalText(review.summary),
      toJsonColumn(review.statistics ?? {}),
      toJsonColumn(review.insights),
      toJsonColumn(review.nextTodos),
      optionalText(review.sourceProposalId),
      review.createdAt,
      review.updatedAt,
    ];
    await this.db.execute(UPSERT, params);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM review_logs WHERE id = ?', [id]);
  }

  /** listRecent 的别名。UI 各 store 统一用 listAll，避免每个仓储叫法不同 */
  listAll(limit = 20): Promise<ReviewLog[]> {
    return this.listRecent(limit);
  }

  async listRecent(limit = 20): Promise<ReviewLog[]> {

    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM review_logs ORDER BY date DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toReview);
  }
}
