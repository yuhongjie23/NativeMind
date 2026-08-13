/**
 * FocusRepository 的 SQLite 实现
 *
 * countAbortsByTodo 是 InteractionPolicy 判断「反复中断」的数据来源，
 * 用来决定要不要换一种更温和的问法，所以这里只数 aborted。
 */
import type { FocusRepository, FocusSession } from '@application/ports';
import type { UUID } from '@shared-types/common';
import {
  localDayRangeUtc,
  optionalNumber,
  optionalText,
  readNumber,
  readText,
  type Database,
  type SqlParam,
  type SqlRow,
} from '../database';

const COLUMNS = `id, todo_id, duration_minutes, actual_minutes, started_at, completed_at,
       aborted_at, abort_reason, status, notes`;

const UPSERT = `
INSERT INTO focus_sessions (
  id, todo_id, duration_minutes, actual_minutes, started_at, completed_at,
  aborted_at, abort_reason, status, notes
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  todo_id = excluded.todo_id,
  duration_minutes = excluded.duration_minutes,
  actual_minutes = excluded.actual_minutes,
  completed_at = excluded.completed_at,
  aborted_at = excluded.aborted_at,
  abort_reason = excluded.abort_reason,
  status = excluded.status,
  notes = excluded.notes`;

const toRow = (session: FocusSession): SqlParam[] => [
  session.id,
  optionalText(session.todoId),
  session.durationMinutes,
  optionalNumber(session.actualMinutes),
  session.startedAt,
  optionalText(session.completedAt),
  optionalText(session.abortedAt),
  optionalText(session.abortReason),
  session.status,
  optionalText(session.notes),
];

const toSession = (row: SqlRow): FocusSession => ({
  id: String(row.id),
  todoId: readText(row.todo_id),
  durationMinutes: Number(row.duration_minutes),
  actualMinutes: readNumber(row.actual_minutes),
  startedAt: String(row.started_at),
  completedAt: readText(row.completed_at),
  abortedAt: readText(row.aborted_at),
  abortReason: readText(row.abort_reason),
  status: String(row.status) as FocusSession['status'],
  notes: readText(row.notes),
});

export class SqliteFocusRepository implements FocusRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UUID): Promise<FocusSession | null> {
    const row = await this.db.selectOne(`SELECT ${COLUMNS} FROM focus_sessions WHERE id = ?`, [id]);
    return row ? toSession(row) : null;
  }

  /**
   * 当前进行中的专注。理论上最多一条，
   * 但如果上次异常退出留下了脏 active 记录，取最近的那条更符合直觉。
   */
  async findActive(): Promise<FocusSession | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE status = 'active' ORDER BY started_at DESC LIMIT 1`
    );
    return row ? toSession(row) : null;
  }

  /** 回收崩溃遗留的「active」幽灵会话：超过 maxAgeHours 的一律标记 aborted，返回清理条数 */
  async abortStaleActive(maxAgeHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
    return this.db.execute(
      `UPDATE focus_sessions SET status = 'aborted', abort_reason = '应用异常退出'
       WHERE status = 'active' AND started_at < ?`,
      [cutoff]
    );
  }

  async findByDate(date: string): Promise<FocusSession[]> {
    const [start, end] = localDayRangeUtc(date);
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC`,
      [start, end]
    );
    return rows.map(toSession);
  }

  async findByDateRange(from: string, to: string): Promise<FocusSession[]> {
    const [rangeStart] = localDayRangeUtc(from);
    const [, rangeEnd] = localDayRangeUtc(to);
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC`,
      [rangeStart, rangeEnd]
    );
    return rows.map(toSession);
  }

  /** 近 7 天内中断次数：太久以前的反复中断不该一直触发「反复中断」陪伴提示 */
  async countAbortsByTodo(todoId: UUID, withinDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString();
    const row = await this.db.selectOne(
      `SELECT COUNT(*) AS total FROM focus_sessions
       WHERE todo_id = ? AND status = 'aborted' AND started_at >= ?`,
      [todoId, cutoff]
    );
    return Number(row?.total ?? 0);
  }

  /**
   * 供 UI 列表使用。
   * 默认拉全量（个人工具：几年专注也才几千条），否则「连续专注天数」这种
   * 统计会被 200 条窗口截断 —— 重度用户的实际 streak 会显示偏小。
   */
  async listAll(limit = 100000): Promise<FocusSession[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM focus_sessions ORDER BY started_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toSession);
  }

  async save(session: FocusSession): Promise<void> {
    await this.db.execute(UPSERT, toRow(session));
  }
}


