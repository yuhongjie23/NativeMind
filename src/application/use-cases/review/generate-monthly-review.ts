/**
 * GenerateMonthlyReviewUseCase - 聚合最近 30 天数据生成月度复盘草稿
 *
 * 与周复盘同构，只是时间窗更长。用 deep（大模型）跑，输出更深度的回顾。
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
import { now, today } from '../../shared/utils';
import { dateRange } from './generate-weekly-review';
import { draftToReviewLog } from './generate-daily-review';

const MONTH_DAYS = 30;

export class GenerateMonthlyReviewUseCase {
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

    const dates = dateRange(date, MONTH_DAYS);
    // 一次区间查询聚合 30 天，替代逐日 30×2 次 IPC
    const [todos, focusSessions] = await Promise.all([
      this.todoRepo.findByDateRange(dates[dates.length - 1], date),
      this.focusRepo.findByDateRange(dates[dates.length - 1], date),
    ]);

    const draft = await this.generator.generate({
      reviewType: 'monthly',
      date,
      todos,
      focusSessions,
    });

    const statistics = {
      focusMinutes: focusSessions
        .filter((session) => session.status === 'completed')
        .reduce((sum, session) => sum + (session.actualMinutes ?? session.durationMinutes), 0),
      tasksCompleted: todos.filter((todo) => todo.status === 'completed').length,
      tasksTotal: todos.length,
      daysCovered: dates.length,
    };

    // 复用已有行的 id，保证事件/返回里的 reviewId 与库里行一致
    const existingId = (await this.reviewRepo.findByDate(date, 'monthly'))?.id;

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      { actionType: 'generate_review', summary: `截至 ${date} 的月度复盘草稿`, payload: draft },
      async (payload) => {
        const review = draftToReviewLog(payload, 'monthly', date, statistics, existingId);
        await this.reviewRepo.save(review);
        return review;
      }
    );

    if (!confirmed || !result) return null;

    await this.eventBus.publish({
      type: 'ReviewGenerated',
      reviewId: result.id,
      reviewType: 'monthly',
      date,
      timestamp: now(),
    });

    return result;
  }
}
