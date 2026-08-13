/**
 * 复盘自动补生成
 *
 * 复盘本质是 AI 建议型写入（架构铁律：必须走确认门），所以这里只负责
 * 「发现缺失并触发生成」，是否写入仍由用户在确认框里决定。用户拒绝或
 * 专注中被拦都是静默的——自动补不该变成打扰。
 *
 * 触发时机（启动时调用一次）：
 * - 日复盘：昨天有学习数据（任务/专注）且没有日复盘 → 补
 * - 周复盘：周一，上周有数据且没有周复盘 → 补
 * - 月复盘：每月 1 号，上月有数据且没有月复盘 → 补
 *
 * 没数据的空窗日不补：空窗日的复盘没有内容可总结，弹确认框纯属打扰。
 * 已存在同日期复盘（手动生成过）也不补：UPSERT 会覆盖，不该在用户
 * 已经复盘过之后又弹一次。
 */
import { formatLocalDate } from '@application/shared/utils';
import { describeError, repositories, useCases } from './runtime';

/** 某天是否有值得复盘的学习数据（任务或专注记录） */
const hasActivity = async (date: string): Promise<boolean> => {
  try {
    const [todos, focus] = await Promise.all([
      repositories.todo.findByDate(date),
      repositories.focus.findByDate(date),
    ]);
    return todos.length > 0 || focus.length > 0;
  } catch {
    return false; // 读取失败视为无数据，宁可不补也不打扰
  }
};

/** 前 N 天的日期（本地时区，格式 YYYY-MM-DD） */
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatLocalDate(d);
};

/** 周几：0=周日 … 6=周六 */
const dayOfWeek = (): number => new Date().getDay();

/** 上月最后一天（即上月区间终点） */
const lastDayOfPreviousMonth = (): string => {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 0));
};

/** 周复盘窗口终点 = 上周日（周一触发时即昨天，通用：距今天最近的周日） */
const lastSunday = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - dayOfWeek());
  return formatLocalDate(d);
};

/** 区间内是否有学习数据（周/月复盘窗口） */
const hasActivityInRange = async (from: string, to: string): Promise<boolean> => {
  try {
    const [todos, focus] = await Promise.all([
      repositories.todo.findByDateRange(from, to),
      repositories.focus.findByDateRange(from, to),
    ]);
    return todos.length > 0 || focus.length > 0;
  } catch {
    return false;
  }
};

/** 串行触发，避免同时弹多个确认框 */
const backfillDaily = async (): Promise<void> => {
  const date = daysAgo(1); // 昨天
  if (!(await hasActivity(date))) return;
  try {
    const existing = await repositories.review.findByDate(date, 'daily');
    if (existing) return; // 已手动复盘过，不覆盖打扰
  } catch {
    return;
  }
  try {
    await useCases.generateDailyReview.execute({ date });
  } catch (error) {
    console.warn('[review-auto] 补昨日复盘失败:', describeError(error));
  }
};

const backfillWeekly = async (): Promise<void> => {
  if (dayOfWeek() !== 1) return; // 只在周一检查
  const to = lastSunday();
  const from = daysAgo(7);
  if (!(await hasActivityInRange(from, to))) return;
  try {
    const existing = await repositories.review.findByDate(to, 'weekly');
    if (existing) return;
  } catch {
    return;
  }
  try {
    await useCases.generateWeeklyReview.execute({ endDate: to });
  } catch (error) {
    console.warn('[review-auto] 补上周复盘失败:', describeError(error));
  }
};

const backfillMonthly = async (): Promise<void> => {
  const now = new Date();
  if (now.getDate() !== 1) return; // 只在每月 1 号检查
  const to = lastDayOfPreviousMonth();
  // 上月第一天 = 终点所在月的 1 号
  const firstOfMonth = `${to.slice(0, 7)}-01`;
  if (!(await hasActivityInRange(firstOfMonth, to))) return;
  try {
    const existing = await repositories.review.findByDate(to, 'monthly');
    if (existing) return;
  } catch {
    return;
  }
  try {
    await useCases.generateMonthlyReview.execute({ endDate: to });
  } catch (error) {
    console.warn('[review-auto] 补上月复盘失败:', describeError(error));
  }
};

/**
 * 启动时调用：补缺失的日/周/月复盘。
 * 全程静默：用户拒绝（确认框点取消）、专注中被拦、无数据、已存在，
 * 都不打扰；只有真正生成时用户会在确认框里看到草稿。
 */
export const backfillMissingReviews = async (): Promise<void> => {
  // 串行：三个确认框不能同时弹，否则队列叠加体验差
  await backfillDaily();
  await backfillWeekly();
  await backfillMonthly();
};
