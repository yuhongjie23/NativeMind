/**
 * GenerateDailyReviewUseCase
 * AI 生成复盘草稿 → ConfirmationService 确认 → 写库 → 发布事件
 */
import type { EventBus } from '../../events/event-bus';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type {
  FocusRepository,
  ReviewDraft,
  ReviewGeneratorPort,
  ReviewLog,
  ReviewRepository,
  TodoRepository,
} from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { newId, now, today } from '../../shared/utils';

export const draftToReviewLog = (
  draft: ReviewDraft,
  reviewType: 'daily' | 'weekly' | 'monthly',
  date: string,
  statistics?: Record<string, number>,
  /** 传已有行的 id 时复用，保证返回/事件里的 reviewId 与库里真实行一致 */
  existingId?: string
): ReviewLog => {
  const timestamp = now();
  return {
    id: existingId ?? newId(),
    reviewType,
    date,
    content: draft.content,
    summary: draft.summary,
    statistics,
    insights: draft.insights,
    nextTodos: draft.nextTodos,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export class GenerateDailyReviewUseCase {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly todoRepo: TodoRepository,
    private readonly focusRepo: FocusRepository,
    private readonly generator: ReviewGeneratorPort,
    private readonly confirmation: ConfirmationService,
    private readonly eventBus: EventBus,
    private readonly focusPolicy: FocusModePolicy
  ) {}

  async execute(input: { date?: string } = {}): Promise<ReviewLog | null> {
    // 专注期间不做 AI 主动生成
    if (!this.focusPolicy.canInterrupt('ai_suggestion')) return null;

    const date = input.date ?? today();

    // 重新生成即覆盖：仓储按 (review_type, date) UPSERT，同一天重复生成只更新内容，
    // 保证每次都重新聚合当天所有任务
    const todos = await this.todoRepo.findByDate(date);
    const focusSessions = await this.focusRepo.findByDate(date);

    const draft = await this.generator.generate({
      reviewType: 'daily',
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
    };

    // 复用已有行的 id：UPSERT 不会更新 id，重新生成时新 id 与库里行对不上，
    // 事件/返回里的 reviewId 就会指向不存在的行
    const existingId = (await this.reviewRepo.findByDate(date, 'daily'))?.id;

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      { actionType: 'generate_review', summary: `${date} 日复盘草稿`, payload: draft },
      async (payload) => {
        const review = draftToReviewLog(payload, 'daily', date, statistics, existingId);
        await this.reviewRepo.save(review);
        return review;
      }
    );

    if (!confirmed || !result) return null;

    await this.eventBus.publish({
      type: 'ReviewGenerated',
      reviewId: result.id,
      reviewType: 'daily',
      date,
      timestamp: now(),
    });

    return result;
  }
}
