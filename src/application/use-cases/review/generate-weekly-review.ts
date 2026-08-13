/**
 * GenerateWeeklyReviewUseCase - 聚合最近 7 天数据生成周复盘草稿
 */
import type { EventBus } from '../../events/event-bus';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type {
  AppUsageRepository,
  FocusRepository,
  KnowledgeLinkRepository,
  NoteRepository,
  ReviewDraft,
  ReviewGeneratorPort,
  ReviewLog,
  ReviewRepository,
  TodoRepository,
} from '../../ports';
import type { FocusModePolicy } from '../../policies/focus-mode-policy';
import { formatLocalDate, now, today } from '../../shared/utils';
import { draftToReviewLog } from './generate-daily-review';
import { fetchKnowledgeSummary } from './review-knowledge';

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
    private readonly focusPolicy: FocusModePolicy,
    private readonly usageRepo?: AppUsageRepository,
    private readonly linkRepo?: KnowledgeLinkRepository,
    private readonly noteRepo?: NoteRepository
  ) {}

  async execute(input: { endDate?: string } = {}): Promise<ReviewLog | null | undefined> {
    // 专注拦截返回 undefined，用户拒绝返回 null（store 区分提示）
    if (!this.focusPolicy.canInterrupt('ai_suggestion')) return undefined;

    const date = input.endDate ?? today();
    // 重新生成即覆盖：仓储按 (review_type, date) UPSERT，不会堆两份

    const dates = dateRange(date, 7);
    // 一次区间查询聚合 7 天，替代逐日 7×2 次 IPC
    const [todos, focusSessions] = await Promise.all([
      this.todoRepo.findByDateRange(dates[dates.length - 1], date),
      this.focusRepo.findByDateRange(dates[dates.length - 1], date),
    ]);

    // 7 天使用时长聚合：undefined = 无记录（区别于 0）
    let appUsageMinutes: number | undefined;
    let usageFocusMinutes: number | undefined;
    const usageByDate = new Map<string, number>();
    if (this.usageRepo) {
      try {
        const rows = await this.usageRepo.listRange(dates[dates.length - 1], date);
        let appSeconds = 0;
        let focusSeconds = 0;
        for (const row of rows) {
          usageByDate.set(row.date, Math.round(row.appActiveSeconds / 60));
          appSeconds += row.appActiveSeconds;
          focusSeconds += row.focusSeconds;
        }
        if (rows.length > 0) {
          appUsageMinutes = Math.round(appSeconds / 60);
          usageFocusMinutes = Math.round(focusSeconds / 60);
        }
      } catch {
        // 使用时长读取失败：复盘照常生成
      }
    }

    // 已确认的知识链接摘要（⑤）
    const knowledgeSummary = await fetchKnowledgeSummary(this.linkRepo, this.noteRepo);

    const draft = await this.generator.generate({
      reviewType: 'weekly',
      date,
      dates,
      todos,
      focusSessions,
      usageMinutes: appUsageMinutes,
      focusUsageMinutes: usageFocusMinutes,
      usageByDate,
      knowledgeSummary,
    });

    const statistics = {
      focusMinutes: focusSessions
        .filter((s) => s.status === 'completed')
        .reduce((sum, s) => sum + (s.actualMinutes ?? s.durationMinutes), 0),
      // 历史任务完成判定：completedAt 在区间内才算完成，防「重生成旧复盘时统计漂移」
      tasksCompleted: todos.filter((t) => t.status === 'completed' && (t.completedAt?.slice(0, 10) ?? date) <= date).length,
      tasksTotal: todos.length,
      daysCovered: dates.length,
      appMinutes: appUsageMinutes ?? 0,
    };

    // 复用已有行的 id，保证事件/返回里的 reviewId 与库里行一致
    const existingId = (await this.reviewRepo.findByDate(date, 'weekly'))?.id;

    // payload 附上 date/reviewType：崩溃后恢复草稿时能据此定位落库目标
    const draftWithMeta: ReviewDraft = { ...draft, date, reviewType: 'weekly' };

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      { actionType: 'generate_review', summary: `截至 ${date} 的周复盘草稿`, payload: draftWithMeta },
      async (payload, proposalId) => {
        const review = draftToReviewLog(payload, 'weekly', date, statistics, existingId);
        review.sourceProposalId = proposalId;
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
