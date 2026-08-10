/**
 * 每日打卡用例测试
 *
 * 关注点：从当日任务 + 专注聚合出快照；全部任务完成 = 打卡成功；
 * 专注按实际时长；无记录日返回零值；按月列表。
 */
import { describe, expect, it } from 'vitest';
import type {
  DailyCheckIn,
  DailyCheckInRepository,
  FocusRepository,
  FocusSession,
  Todo,
  TodoRepository,
} from '@application/ports';
import {
  DEFAULT_STUDY_GOAL_MINUTES,
  RecordDailyCheckInUseCase,
} from '@application/use-cases/checkin/record-daily-checkin';
import { GetDailyCheckInUseCase } from '@application/use-cases/checkin/get-daily-checkin';
import { ListDailyCheckInsUseCase } from '@application/use-cases/checkin/list-month-checkins';

const todo = (id: string, status: 'active' | 'completed'): Todo =>
  ({
    id,
    title: id,
    status,
    scheduledDate: '2026-08-05',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    tags: [],
    linkedNoteIds: [],
  }) as unknown as Todo;

const session = (id: string, minutes: number): FocusSession =>
  ({
    id,
    durationMinutes: 25,
    actualMinutes: minutes,
    startedAt: '2026-08-05T09:00:00.000Z',
    status: 'completed',
  }) as unknown as FocusSession;

const makeHarness = (todos: Todo[], sessions: FocusSession[]) => {
  const saved = new Map<string, DailyCheckIn>();
  const checkInRepo: DailyCheckInRepository = {
    save: async (checkIn) => void saved.set(checkIn.date, checkIn),
    get: async (date) => saved.get(date) ?? null,
    listMonth: async (yearMonth) =>
      [...saved.values()].filter((c) => c.date.startsWith(`${yearMonth}-`)),
  };
  const todoRepo = { findByDate: async () => todos } as unknown as TodoRepository;
  const focusRepo = { findByDate: async () => sessions } as unknown as FocusRepository;
  return {
    record: new RecordDailyCheckInUseCase(todoRepo, focusRepo, checkInRepo),
    checkInRepo,
  };
};

describe('RecordDailyCheckInUseCase', () => {
  it('聚合当日任务与专注：完成数 / 专注分钟 / 学习目标，任务未全完成则不打卡', async () => {
    const { record } = makeHarness(
      [todo('t1', 'completed'), todo('t2', 'completed'), todo('t3', 'active')],
      [session('f1', 25), session('f2', 10)],
    );

    const checkIn = await record.execute('2026-08-05');

    expect(checkIn.tasksTotal).toBe(3);
    expect(checkIn.tasksCompleted).toBe(2);
    expect(checkIn.focusMinutes).toBe(35);
    expect(checkIn.studyGoalMinutes).toBe(DEFAULT_STUDY_GOAL_MINUTES);
    expect(checkIn.checkInDone).toBe(false);
  });

  it('全部任务完成 → 打卡成功', async () => {
    const { record } = makeHarness([todo('t1', 'completed')], []);

    const checkIn = await record.execute('2026-08-05');

    expect(checkIn.checkInDone).toBe(true);
  });

  it('当日没有任务 → 不视为打卡成功', async () => {
    const { record } = makeHarness([], [session('f1', 25)]);

    const checkIn = await record.execute('2026-08-05');

    expect(checkIn.tasksTotal).toBe(0);
    expect(checkIn.checkInDone).toBe(false);
  });

  it('专注提前结束按实际时长计', async () => {
    const { record } = makeHarness([], [session('f1', 12)]);

    const checkIn = await record.execute('2026-08-05');

    expect(checkIn.focusMinutes).toBe(12);
  });

  it('接受配置的学习目标，非法值回退默认', async () => {
    const { record } = makeHarness([], []);

    expect((await record.execute('2026-08-05', 90)).studyGoalMinutes).toBe(90);
    expect((await record.execute('2026-08-05', 0)).studyGoalMinutes).toBe(DEFAULT_STUDY_GOAL_MINUTES);
  });
});

describe('GetDailyCheckInUseCase', () => {
  it('无记录的日子返回零值', async () => {
    const { checkInRepo } = makeHarness([], []);

    const checkIn = await new GetDailyCheckInUseCase(checkInRepo).execute('2026-08-04');

    expect(checkIn.checkInDone).toBe(false);
    expect(checkIn.tasksTotal).toBe(0);
    expect(checkIn.focusMinutes).toBe(0);
  });
});

describe('ListDailyCheckInsUseCase', () => {
  it('按月返回记录', async () => {
    const { record, checkInRepo } = makeHarness([todo('t1', 'completed')], []);
    await record.execute('2026-08-05');
    await record.execute('2026-07-28');

    const list = await new ListDailyCheckInsUseCase(checkInRepo).execute('2026-08');

    expect(list.map((c) => c.date)).toEqual(['2026-08-05']);
  });
});
