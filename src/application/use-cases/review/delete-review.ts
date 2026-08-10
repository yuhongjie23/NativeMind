/**
 * DeleteReviewUseCase - 删除复盘日志
 *
 * 复盘可由用户删除/撤销（比如自动生成的复盘不满意）。删除是破坏性写入，
 * 走确认弹窗，用户点头才删。
 */
import type { UUID } from '@shared-types/common';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { ReviewRepository } from '../../ports';
import { now } from '../../shared/utils';

export class DeleteReviewUseCase {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly confirmation: ConfirmationService,
    private readonly eventBus: EventBus
  ) {}

  async execute(reviewId: UUID): Promise<boolean> {
    const { confirmed } = await this.confirmation.confirmAndRun(
      {
        title: '删除复盘',
        message: '删除这条复盘？删除后可以重新生成。',
        confirmLabel: '删除',
        danger: true,
      },
      async () => {
        await this.reviewRepo.delete(reviewId);
        await this.eventBus.publish({
          type: 'ReviewDeleted',
          reviewId,
          timestamp: now(),
        });
        return true;
      }
    );

    return confirmed;
  }
}
