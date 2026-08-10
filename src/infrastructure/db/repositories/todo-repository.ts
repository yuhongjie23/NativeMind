/**
 * TodoRepository 的 SQLite 实现
 *
 * 只负责「行 ↔ 领域对象」的搬运和 SQL，不带任何业务判断：
 * 状态流转、优先级裁决都在 domain / application 层。
 */
import type { Priority, Todo, TodoRepository, TodoStatus } from '@application/ports';
import type { UUID } from '@shared-types/common';
import {
  fromJsonColumn,
  localDayRangeUtc,
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

const COLUMNS = `id, title, description, status, priority, estimated_minutes,
       scheduled_date, source_goal_id, tags, linked_note_ids, created_at, updated_at, completed_at`;

/** UPSERT 而不是 INSERT：用例层对同一个 Todo 反复 save 是正常操作 */
const UPSERT = `
INSERT INTO todos (
  id, title, description, status, priority, estimated_minutes,
  scheduled_date, source_goal_id, tags, linked_note_ids, created_at, updated_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  priority = excluded.priority,
  estimated_minutes = excluded.estimated_minutes,
  scheduled_date = excluded.scheduled_date,
  source_goal_id = excluded.source_goal_id,
  tags = excluded.tags,
  linked_note_ids = excluded.linked_note_ids,
  updated_at = excluded.updated_at,
  completed_at = excluded.completed_at`;

const toRow = (todo: Todo): SqlParam[] => [
  todo.id,
  todo.title,
  optionalText(todo.description),
  todo.status,
  optionalText(todo.priority),
  optionalNumber(todo.estimatedMinutes),
  optionalText(todo.scheduledDate),
  optionalText(todo.sourceGoalId),
  toJsonColumn(todo.tags),
  toJsonColumn(todo.linkedNoteIds),
  todo.createdAt,
  todo.updatedAt,
  optionalText(todo.completedAt),
];

const toTodo = (row: SqlRow): Todo => ({
  id: String(row.id),
  title: String(row.title),
  description: readText(row.description),
  status: String(row.status) as TodoStatus,
  priority: readText(row.priority) as Priority | undefined,
  estimatedMinutes: readNumber(row.estimated_minutes),
  scheduledDate: readText(row.scheduled_date),
  sourceGoalId: readText(row.source_goal_id),
  tags: fromJsonColumn<string[]>(row.tags, []),
  linkedNoteIds: fromJsonColumn<UUID[]>(row.linked_note_ids, []),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  completedAt: readText(row.completed_at),
});

export class SqliteTodoRepository implements TodoRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UUID): Promise<Todo | null> {
    const row = await this.db.selectOne(`SELECT ${COLUMNS} FROM todos WHERE id = ?`, [id]);
    return row ? toTodo(row) : null;
  }

  /**
   * 按日期取当天任务。没排期的按创建日算，
   * 这样「今天随手记的」不会因为忘填 scheduled_date 而在今日视图里消失。
   */
  async findByDate(date: string): Promise<Todo[]> {
    // created_at 是 UTC，按本地日零点的 UTC 区间查，避免凌晨任务归错天
    const [start, end] = localDayRangeUtc(date);
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM todos
       WHERE scheduled_date = ?
          OR (scheduled_date IS NULL AND created_at >= ? AND created_at < ?)
       ORDER BY created_at DESC`,
      [date, start, end]
    );
    return rows.map(toTodo);
  }

  async findByStatus(status: TodoStatus, limit = 50): Promise<Todo[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM todos WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      [status, limit]
    );
    return rows.map(toTodo);
  }

  /** 复盘按周取数据，date 为闭区间 YYYY-MM-DD */
  async findByDateRange(from: string, to: string): Promise<Todo[]> {
    const [rangeStart] = localDayRangeUtc(from);
    const [, rangeEnd] = localDayRangeUtc(to);
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM todos
       WHERE (scheduled_date BETWEEN ? AND ?)
          OR (scheduled_date IS NULL AND created_at >= ? AND created_at < ?)
       ORDER BY created_at DESC`,
      [from, to, rangeStart, rangeEnd]
    );
    return rows.map(toTodo);
  }

  /**
   * 供 UI 列表使用。带默认上限，不做无界查询：
   * 用户攒到几千条任务时，一次性拉全表会让首屏卡住，
   * 而列表视图本来也只能显示有限几屏。
   */
  async listAll(limit = 200): Promise<Todo[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM todos ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toTodo);
  }

  async save(todo: Todo): Promise<void> {
    await this.db.execute(UPSERT, toRow(todo));
  }


  /** 批量确认 AI 草稿时用：一个事务内全成或全不成，不留半份任务列表 */
  async saveMany(todos: Todo[]): Promise<void> {
    if (todos.length === 0) return;
    await this.db.transaction(async (tx: SqlDriver) => {
      for (const todo of todos) {
        await tx.execute(UPSERT, toRow(todo));
      }
    });
  }

  async delete(id: UUID): Promise<void> {
    await this.db.execute('DELETE FROM todos WHERE id = ?', [id]);
  }

  /**
   * 事务化替换：删原任务 + 整批写入新任务，要么全成要么全不成。
   * 「替换为拆分」用：先删后写在事务里，任何一条失败都不会留下「原任务已删、新任务没写」的丢数据状态。
   */
  async replaceAll(deleteId: UUID, todos: Todo[]): Promise<void> {
    await this.db.transaction(async (tx: SqlDriver) => {
      await tx.execute('DELETE FROM todos WHERE id = ?', [deleteId]);
      for (const todo of todos) {
        await tx.execute(UPSERT, toRow(todo));
      }
    });
  }
}
