/**
 * RecoverPendingReviewUseCase - 崩溃恢复：把未决的复盘草稿重新交给用户
 *
 * 复盘生成流程里 confirmAndCommit 在弹窗**之前**就把草稿落进 action_proposals 表
 * （payload 完整草稿 + date/reviewType 元数据）。如果应用在弹窗期间崩溃/被强杀，
 * 草稿留在库里 status='pending'——此前没有任何代码读取它，24 小时后被维护任务
 * 静默标 expired，用户视角 = 草稿凭空消失。
 *
 * 本用例：启动时列出 pending 的 generate_review 草稿，逐个重新弹窗确认；
 * 用户确认后把草稿原样写入 review_logs（复用现有落库逻辑），拒绝则标 rejected。
 */
import type { ActionProposalRepository } from '../../confirmation/action-proposal';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { ReviewDraft, ReviewLog, ReviewRepository } from '../../ports';
import { newId, now } from '../../shared/utils';

export class RecoverPendingReviewUseCase {
  constructor(
    private readonly proposalRepo: ActionProposalRepository,
    private readonly reviewRepo: ReviewRepository,
    private readonly confirmation: ConfirmationService,
    private readonly eventBus: EventBus
  ) {}

  /** 恢复全部未决复盘草稿。返回恢复了多少条（含用户拒绝的）。 */
  async execute(): Promise<number> {
    const pending = await this.proposalRepo.listPending(20);
    const reviews = pending.filter((p) => p.actionType === 'generate_review');
    if (reviews.length === 0) return 0;

    let recovered = 0;
    for (const proposal of reviews) {
      const payload = proposal.payload as Partial<ReviewDraft>;
      const reviewType = payload.reviewType;
      const date = payload.date;
      // 旧版本草稿没有 date/reviewType 元数据：无法定位落库目标，跳过（标过期避免重复提示）
      if (!reviewType || !date) {
        await this.proposalRepo.updateStatus(proposal.id, 'expired', now());
        continue;
      }

      // 崩溃中间态收敛：仅当「目标复盘行确实由这个提案写入」时，才判定 commit 已完成。
      // sourceProposalId 精确匹配是唯一可信依据——重生成已有复盘时旧复盘本来就存在，
      // 若只看「存在」会把未提交的新草稿误判成已确认而静默丢弃。
      const existing = await this.reviewRepo.findByDate(date, reviewType);
      if (existing?.sourceProposalId === proposal.id) {
        await this.proposalRepo.updateStatus(proposal.id, 'confirmed', now());
        recovered += 1;
        continue;
      }

      // 旧版本提案没有 sourceProposalId 且目标复盘已存在：无法判断新草稿是否已提交。
      // 保守处理——不弹窗也不静默丢弃，标 expired 留待用户重新生成（避免幽灵弹窗，
      // 也避免覆盖用户已有的新复盘）。
      if (existing) {
        await this.proposalRepo.updateStatus(proposal.id, 'expired', now());
        continue;
      }

      const result = await this.confirmation.confirmPending<ReviewDraft, ReviewLog>(
        proposal.id,
        async (draft, proposalId) => {
          const review: ReviewLog = {
            id: newId(),
            reviewType,
            date,
            content: draft.content,
            summary: draft.summary,
            statistics: undefined,
            insights: draft.insights,
            nextTodos: draft.nextTodos,
            sourceProposalId: proposalId,
            createdAt: now(),
            updatedAt: now(),
          };
          await this.reviewRepo.save(review);
          await this.eventBus.publish({
            type: 'ReviewGenerated',
            reviewId: review.id,
            reviewType,
            date,
            timestamp: now(),
          });
          return review;
        }
      );

      if (result && result.confirmed) recovered += 1;
    }
    return recovered;
  }
}
