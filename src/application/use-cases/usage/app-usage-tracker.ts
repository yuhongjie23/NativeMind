/**
 * AppUsageTracker - 应用使用时长追踪
 *
 * 由运行时周期调用（interval + 退出时各一次），把「过去一段时间应用打开多久、
 * 其中专注多久」累加进当日的 app_usage 行。
 *
 * 设计：
 * - 调用方维护「上一次快照时间」，每次 tick 传 delta（秒），本用例只做累加；
 * - 跨天切分由调用方负责（用本地日期判断，跨天时先落旧日再开新日）；
 * - 周期落盘是主路径（窗口直接关闭时 beforeunload 不可靠），退出时的最后一次
 *   调用只是补增量，重复累加也无害（add 是幂等累加）。
 */
import type { AppUsageRepository } from '../../ports';

export class AppUsageTracker {
  constructor(private readonly usageRepo: AppUsageRepository) {}

  /** 累加一段时长到指定日期。appSeconds/focusSeconds 为增量秒数。 */
  async record(
    date: string,
    appSeconds: number,
    focusSeconds: number
  ): Promise<void> {
    if (appSeconds <= 0 && focusSeconds <= 0) return;
    await this.usageRepo.add(date, appSeconds, focusSeconds);
  }

  /** 查某日累计（用于跨天切分前的旧日补记判断 / 复盘数据源） */
  async get(date: string) {
    return this.usageRepo.get(date);
  }

  /** 日期区间累计（周/月复盘统计用） */
  async sumRange(from: string, to: string): Promise<{
    appSeconds: number;
    focusSeconds: number;
    days: number;
  }> {
    const rows = await this.usageRepo.listRange(from, to);
    return rows.reduce(
      (acc, row) => ({
        appSeconds: acc.appSeconds + row.appActiveSeconds,
        focusSeconds: acc.focusSeconds + row.focusSeconds,
        days: acc.days + 1,
      }),
      { appSeconds: 0, focusSeconds: 0, days: 0 }
    );
  }
}
