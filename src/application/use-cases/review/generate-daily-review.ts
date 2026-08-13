/**
 * GenerateDailyReviewUseCase
 * AI 生成复盘草稿 → ConfirmationService 确认 → 写库 → 发布事件
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
import { newId, now, today } from '../../shared/utils';
import { fetchKnowledgeSummary } from './review-knowledge';
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
    private readonly focusPolicy: FocusModePolicy,
    private readonly usageRepo?: AppUsageRepository,
    private readonly linkRepo?: KnowledgeLinkRepository,
    private readonly noteRepo?: NoteRepository
  ) {}

  /**
   * 生成日复盘。
   * @returns ReviewLog 已生成；null 用户拒绝/未确认；undefined 专注中被拦（调用方提示原因）
   */
  async execute(input: { date?: string } = {}): Promise<ReviewLog | null | undefined> {
    // 专注期间不做 AI 主动生成。但生成复盘是用户主动点按钮，不是 AI 自发打扰，
    // 这里区分两种「没生成」：专注拦截返回 undefined（store 据此提示原因），
    // 用户拒绝确认返回 null（提示「已取消」）
    if (!this.focusPolicy.canInterrupt('ai_suggestion')) return undefined;

    const date = input.date ?? today();

    // 重新生成即覆盖：仓储按 (review_type, date) UPSERT，同一天重复生成只更新内容，
    // 保证每次都重新聚合当天所有任务
    const todos = await this.todoRepo.findByDate(date);
    const focusSessions = await this.focusRepo.findByDate(date);

    // 当日应用使用时长：undefined = 无记录（区别于 0——「没采集」≠「没使用」）
    let appUsageMinutes: number | undefined;
    let usageFocusMinutes: number | undefined;
    if (this.usageRepo) {
      try {
        const usage = await this.usageRepo.get(date);
        if (usage) {
          appUsageMinutes = Math.round(usage.appActiveSeconds / 60);
          usageFocusMinutes = Math.round(usage.focusSeconds / 60);
        }
      } catch {
        // 使用时长读取失败：复盘照常生成，只是缺这一项统计
      }
    }

    // 已确认的知识链接摘要（⑤）：复盘时可引用显式关系。失败/无链接 → 空摘要，不阻塞。
    const knowledgeSummary = await fetchKnowledgeSummary(this.linkRepo, this.noteRepo);

    const draft = await this.generator.generate({
      reviewType: 'daily',
      date,
      todos,
      focusSessions,
      usageMinutes: appUsageMinutes,
      focusUsageMinutes: usageFocusMinutes,
      knowledgeSummary,
    });

    const statistics = {
      focusMinutes: focusSessions
        .filter((s) => s.status === 'completed')
        .reduce((sum, s) => sum + (s.actualMinutes ?? s.durationMinutes), 0),
      tasksCompleted: todos.filter((t) => t.status === 'completed').length,
      tasksTotal: todos.length,
      appMinutes: appUsageMinutes ?? 0,
    };

    // 复用已有行的 id：UPSERT 不会更新 id，重新生成时新 id 与库里行对不上，
    // 事件/返回里的 reviewId 就会指向不存在的行
    const existingId = (await this.reviewRepo.findByDate(date, 'daily'))?.id;

    // payload 附上 date/reviewType：崩溃后恢复草稿时能据此定位落库目标，
    // 不依赖弹窗时点的上下文（否则恢复弹窗拿到草稿却不知道写到哪天哪类复盘）
    const draftWithMeta: ReviewDraft = { ...draft, date, reviewType: 'daily' };

    const { confirmed, result } = await this.confirmation.confirmAndCommit(
      { actionType: 'generate_review', summary: `${date} 日复盘草稿`, payload: draftWithMeta },
      async (payload, proposalId) => {
        const review = draftToReviewLog(payload, 'daily', date, statistics, existingId);
        // 关联确认提案：崩溃恢复时用 sourceProposalId 精确判定「这个提案是否已提交」
        review.sourceProposalId = proposalId;
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
