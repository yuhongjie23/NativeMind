/**
 * 每日打卡仓储集成测试（真 SQLite）
 *
 * 验证 012 迁移建表 + upsert 覆盖 + 按月列出。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyCheckIn } from '@application/ports';
import { Database } from '@infrastructure/db/database';
import { SqliteDailyCheckInRepository } from '@infrastructure/db/repositories/checkin-repository';
import { NodeSqliteDriver } from '../sqlite-driver';

const checkIn = (overrides: Partial<DailyCheckIn> = {}): DailyCheckIn => ({
  date: '2026-08-05',
  tasksTotal: 3,
  tasksCompleted: 3,
  focusMinutes: 50,
  studyGoalMinutes: 50,
  checkInDone: true,
  updatedAt: '2026-08-05T12:00:00.000Z',
  ...overrides,
});

describe('SqliteDailyCheckInRepository', () => {
  let repo: SqliteDailyCheckInRepository;

  beforeEach(async () => {
    const db = new Database(new NodeSqliteDriver());
    await db.migrate(); // 全量迁移，含 012_daily_checkins
    repo = new SqliteDailyCheckInRepository(db);
  });

  it('保存后可读回，布尔 / 数字往返一致', async () => {
    await repo.save(checkIn());

    expect(await repo.get('2026-08-05')).toEqual(checkIn());
  });

  it('同一天重算后 upsert 覆盖', async () => {
    await repo.save(checkIn({ tasksCompleted: 1, checkInDone: false }));
    await repo.save(checkIn({ tasksCompleted: 3, checkInDone: true }));

    const record = await repo.get('2026-08-05');
    expect(record?.tasksCompleted).toBe(3);
    expect(record?.checkInDone).toBe(true);
  });

  it('按月列出，日期升序', async () => {
    await repo.save(checkIn({ date: '2026-08-03' }));
    await repo.save(checkIn({ date: '2026-08-05' }));
    await repo.save(checkIn({ date: '2026-07-28' }));

    const list = await repo.listMonth('2026-08');

    expect(list.map((c) => c.date)).toEqual(['2026-08-03', '2026-08-05']);
  });

  it('不存在的日期返回 null', async () => {
    expect(await repo.get('2026-01-01')).toBeNull();
  });
});
