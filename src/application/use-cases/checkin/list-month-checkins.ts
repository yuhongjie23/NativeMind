/**
 * ListDailyCheckInsUseCase - 某月（YYYY-MM）的全部打卡记录，日历用
 */
import type { DailyCheckIn, DailyCheckInRepository } from '../../ports';

export class ListDailyCheckInsUseCase {
  constructor(private readonly checkInRepo: DailyCheckInRepository) {}

  async execute(yearMonth: string): Promise<DailyCheckIn[]> {
    return this.checkInRepo.listMonth(yearMonth);
  }
}
