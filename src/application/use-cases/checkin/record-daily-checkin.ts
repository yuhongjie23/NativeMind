/**
 * RecordDailyCheckInUseCase - 重算并落库某一天的打卡快照
 *
 * 数据源是任务与专注会话（二者都已持久化），这里聚合出当日快照写进
 * daily_checkins，供打卡日历与后续学习效率分析读取。
 * 打卡成功 = 当日所有任务完成（tasks_total > 0 且 tasks_completed 达标）。
 */
import type {
  DailyCheckIn,
  DailyCheckInRepository,
  FocusRepository,
  TodoRepository,
} from '../../ports';
import { formatLocalDate, now } from '../../shared/utils';

/** 当日学习目标分钟数：学习进度 = 当日专注分钟 / 目标。先常量，后续可做成设置 */
export const DEFAULT_STUDY_GOAL_MINUTES = 50;

export class RecordDailyCheckInUseCase {
  constructor(
    private readonly todoRepo: TodoRepository,
    private readonly focusRepo: FocusRepository,
    private readonly checkInRepo: DailyCheckInRepository
  ) {}

  async execute(
    date = formatLocalDate(new Date()),
    studyGoalMinutes = DEFAULT_STUDY_GOAL_MINUTES
  ): Promise<DailyCheckIn> {
    const [todos, sessions] = await Promise.all([
      this.todoRepo.findByDate(date),
      this.focusRepo.findByDate(date),
    ]);

    const tasksTotal = todos.length;
    const tasksCompleted = todos.filter((todo) => todo.status === 'completed').length;
    const focusMinutes = sessions
      .filter((session) => session.status === 'completed')
      .reduce((sum, session) => sum + (session.actualMinutes ?? session.durationMinutes), 0);

    const checkIn: DailyCheckIn = {
      date,
      tasksTotal,
      tasksCompleted,
      focusMinutes,
      studyGoalMinutes: studyGoalMinutes > 0 ? studyGoalMinutes : DEFAULT_STUDY_GOAL_MINUTES,
      checkInDone: tasksTotal > 0 && tasksCompleted >= tasksTotal,
      updatedAt: now(),
    };
    await this.checkInRepo.save(checkIn);
    return checkIn;
  }
}
