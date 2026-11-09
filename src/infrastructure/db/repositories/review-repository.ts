/**
 * ReviewRepository 的 SQLite 实现
 *
 * (review_type, date) 上有唯一索引，所以这里按这对键做 UPSERT：
 * 同一天重复生成复盘是覆盖，不是堆两份。
 */
import type { ReviewLog, ReviewRepository, ReviewTrace, ReviewFollowUp, Todo } from '@application/ports';
import { SqliteTodoRepository } from './todo-repository';
import {
  fromJsonColumn,
  optionalText,
  readText,
  toJsonColumn,
  Database,
  type SqlParam,
  type SqlRow,
} from '../database';

const COLUMNS = `id, review_type, date, content, summary, statistics, insights,
       next_todos, source_proposal_id, created_at, updated_at, evidence`;

const UPSERT = `
INSERT INTO review_logs (
  id, review_type, date, content, summary, statistics, insights, next_todos,
  source_proposal_id, created_at, updated_at, evidence
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(review_type, date) DO UPDATE SET
  content = excluded.content,
  summary = excluded.summary,
  statistics = excluded.statistics,
  insights = excluded.insights,
  next_todos = excluded.next_todos,
  source_proposal_id = excluded.source_proposal_id,
  evidence = excluded.evidence,
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
  evidence: fromJsonColumn<ReviewTrace | undefined>(row.evidence, undefined),
  sourceProposalId: readText(row.source_proposal_id) || undefined,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const FOLLOW_UP_QUERY = `SELECT f.*, t.status, t.completed_at FROM review_follow_ups f
  LEFT JOIN todos t ON t.id = f.todo_id`;
const toFollowUp = (row: SqlRow): ReviewFollowUp => ({
  id: String(row.id), reviewId: String(row.review_id), suggestion: String(row.suggestion),
  todoId: readText(row.todo_id), adoptedAt: String(row.adopted_at),
  status: row.status ? String(row.status) as Todo['status'] : 'deleted',
  completedAt: readText(row.completed_at),
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
      review.evidence ? toJsonColumn(review.evidence) : null,
    ];
    await this.db.execute(UPSERT, params);
  }

  async adoptSuggestion(reviewId: string, suggestion: string, todo: Todo): Promise<{ followUp: ReviewFollowUp; created: boolean }> {
    return this.db.transaction(async tx => {
      const existing = await tx.select(`${FOLLOW_UP_QUERY} WHERE f.review_id = ? AND f.suggestion = ?`, [reviewId, suggestion]);
      if (existing[0]) return { followUp: toFollowUp(existing[0]), created: false };
      // 在同一事务复查建议，避免生成新版复盘后仍采用过时页面上的建议。
      const rows = await tx.select('SELECT next_todos FROM review_logs WHERE id = ?', [reviewId]);
      const suggestions = fromJsonColumn<string[]>(rows[0]?.next_todos, []);
      if (!suggestions.some(title => title.trim() === suggestion)) throw new Error('复盘建议已变化，请刷新后再试。');
      await new SqliteTodoRepository(new Database(tx)).save(todo);
      await tx.execute('INSERT INTO review_follow_ups (id, review_id, suggestion, todo_id, adopted_at) VALUES (?, ?, ?, ?, ?)',
        [todo.id, reviewId, suggestion, todo.id, todo.createdAt]);
      return { followUp: { id: todo.id, reviewId, suggestion, todoId: todo.id, adoptedAt: todo.createdAt, status: todo.status }, created: true };
    });
  }

  async listFollowUps(limit?: number): Promise<ReviewFollowUp[]> {
    return (await this.db.select(`${FOLLOW_UP_QUERY} ORDER BY f.adopted_at DESC, f.id LIMIT ?`, [limit ?? -1])).map(toFollowUp);
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
