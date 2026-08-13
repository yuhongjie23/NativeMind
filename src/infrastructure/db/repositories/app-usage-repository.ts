/**
 * 每日应用使用时长 Repository
 *
 * date 为 PK，add 走「INSERT + ON CONFLICT 累加」——周期落盘幂等，
 * 同一时刻多次写入（interval + 退出）不会互相覆盖，只会正确累加。
 */
import type { AppUsage, AppUsageRepository } from '@application/ports';
import type { Database, SqlRow } from '../database';

const COLUMNS = `date, app_active_seconds, focus_seconds, updated_at`;

const toUsage = (row: SqlRow): AppUsage => ({
  date: String(row.date),
  appActiveSeconds: Number(row.app_active_seconds),
  focusSeconds: Number(row.focus_seconds),
  updatedAt: String(row.updated_at),
});

export class SqliteAppUsageRepository implements AppUsageRepository {
  constructor(private readonly db: Database) {}

  async add(date: string, appActiveSeconds: number, focusSeconds: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO app_usage (${COLUMNS}) VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         app_active_seconds = app_active_seconds + excluded.app_active_seconds,
         focus_seconds = focus_seconds + excluded.focus_seconds,
         updated_at = excluded.updated_at`,
      [date, appActiveSeconds, focusSeconds, now]
    );
  }

  async get(date: string): Promise<AppUsage | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM app_usage WHERE date = ?`,
      [date]
    );
    return row ? toUsage(row) : null;
  }

  async listRange(from: string, to: string): Promise<AppUsage[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM app_usage WHERE date >= ? AND date <= ? ORDER BY date`,
      [from, to]
    );
    return rows.map(toUsage);
  }
}
