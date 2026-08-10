/**
 * GenerateWeeklyReviewUseCase - 聚合最近 7 天数据生成周复盘草稿
 */
import type { EventBus } from '../../events/event-bus';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type {
  FocusRepository,
  ReviewGeneratorPort,
  ReviewLog,
  ReviewRepository,
  TodoRepository,
} from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { formatLocalDate, now, today } from '../../shared/utils';
import { draftToReviewLog } from './generate-daily-review';

/** 返回自 endDate 起往前 days 天的日期列表（本地时区，绕开 UTC 切片的一天错位） */
export const dateRange = (endDate: string, days: number): string[] => {
  const [year, month, day] = endDate.split('-').map(Number);
  const end = new Date(year, month - 1, day);
  return Array.from({ length: days }, (_, i) => {
    const cursor = new Date(end);
    cursor.setDate(end.getDate() - i);
    return formatLocalDate(cursor);
  });
};

export class GenerateWeeklyReviewUseCase {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly todoRepo: TodoRepository,
    private readonly focusRepo: FocusRepository,
    private readonly generator: ReviewGeneratorPort,
    private readonly confirmation: ConfirmationService,
    private readonly eventBus: EventBus,
    private readonly focusPolicy: FocusModePolicy
  ) {}

  async execute(input: { endDate?: string } = {}): Promise<ReviewLog | null> {
    if (!this.focusPolicy.canInterrupt('ai_suggestion')) return null;

    const date = input.endDate ?? today();
    // 重新生成即覆盖：仓储按 (review_type, date) UPSERT，不会堆两份

    const dates = dateRange(date, 7);
    // 一次区间查询聚合 7 天，替代逐日 7×2 次 IPC
    const [todos, focusSessions] = await Promise.all([
      this.todoRepo.findByDateRange(dates[dates.length - 1], date),
      this.focusRepo.findByDateRange(dates[dates.length - 1], date),
    ]);

    const draft = await this.generator.generate({
      reviewType: 'weekly',
      date,
      todos,
      focusSessions,
    });

    const statistics = {
      focusMinutes: focusSessions
        .filter((s) => s.status === 'completed')
        .reduce((sum, s) => sum + (s.actualMinutes ?? s.durationMinutes), 0),
      tasksCompleted: todos.filter((t) => t.status === 'completed').length,
      tasksTotal: todos.length,
      daysCovered: dates.length,
    };

    // 复用已有行的 id，保证事件/返回里的 reviewId 与库里行一致
    const existingId = (await this.reviewRepo.findByDate(date, 'weekly'))?.id;

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      { actionType: 'generate_review', summary: `截至 ${date} 的周复盘草稿`, payload: draft },
      async (payload) => {
        const review = draftToReviewLog(payload, 'weekly', date, statistics, existingId);
        await this.reviewRepo.save(review);
        return review;
      }
    );

    if (!confirmed || !result) return null;

    await this.eventBus.publish({
      type: 'ReviewGenerated',
      reviewId: result.id,
      reviewType: 'weekly',
      date,
      timestamp: now(),
    });

    return result;
  }
}
