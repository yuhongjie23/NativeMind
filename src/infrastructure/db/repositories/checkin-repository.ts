/**
 * 每日打卡 Repository
 *
 * date 为 PK，重算后 upsert。列表按日期升序，日历按月取。
 */
import type { DailyCheckIn, DailyCheckInRepository } from '@application/ports';
import {
  fromBoolColumn,
  toBoolColumn,
  type Database,
  type SqlRow,
} from '../database';

const COLUMNS = `date, tasks_total, tasks_completed, focus_minutes,
       study_goal_minutes, check_in_done, updated_at`;

const toCheckIn = (row: SqlRow): DailyCheckIn => ({
  date: String(row.date),
  tasksTotal: Number(row.tasks_total),
  tasksCompleted: Number(row.tasks_completed),
  focusMinutes: Number(row.focus_minutes),
  studyGoalMinutes: Number(row.study_goal_minutes),
  checkInDone: fromBoolColumn(row.check_in_done),
  updatedAt: String(row.updated_at),
});

export class SqliteDailyCheckInRepository implements DailyCheckInRepository {
  constructor(private readonly db: Database) {}

  async save(checkIn: DailyCheckIn): Promise<void> {
    await this.db.execute(
      `INSERT INTO daily_checkins (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         tasks_total = excluded.tasks_total,
         tasks_completed = excluded.tasks_completed,
         focus_minutes = excluded.focus_minutes,
         study_goal_minutes = excluded.study_goal_minutes,
         check_in_done = excluded.check_in_done,
         updated_at = excluded.updated_at`,
      [
        checkIn.date,
        checkIn.tasksTotal,
        checkIn.tasksCompleted,
        checkIn.focusMinutes,
        checkIn.studyGoalMinutes,
        toBoolColumn(checkIn.checkInDone),
        checkIn.updatedAt,
      ]
    );
  }

  async get(date: string): Promise<DailyCheckIn | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM daily_checkins WHERE date = ?`,
      [date]
    );
    return row ? toCheckIn(row) : null;
  }

  async listMonth(yearMonth: string): Promise<DailyCheckIn[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM daily_checkins WHERE date LIKE ? ORDER BY date`,
      [`${yearMonth}-%`]
    );
    return rows.map(toCheckIn);
  }
}
