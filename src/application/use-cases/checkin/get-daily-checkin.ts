/**
 * GetDailyCheckInUseCase - 读某一天的打卡快照
 *
 * 没记录的日子返回零值（不建表），日历据此把未打卡日显示为空。
 */
import type { DailyCheckIn, DailyCheckInRepository } from '../../ports';
import { formatLocalDate } from '../../shared/utils';

export const emptyDailyCheckIn = (date: string): DailyCheckIn => ({
  date,
  tasksTotal: 0,
  tasksCompleted: 0,
  focusMinutes: 0,
  studyGoalMinutes: 0,
  checkInDone: false,
  updatedAt: new Date().toISOString(),
});

export class GetDailyCheckInUseCase {
  constructor(private readonly checkInRepo: DailyCheckInRepository) {}

  async execute(date = formatLocalDate(new Date())): Promise<DailyCheckIn> {
    return (await this.checkInRepo.get(date)) ?? emptyDailyCheckIn(date);
  }
}
