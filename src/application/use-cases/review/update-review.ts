/**
 * UpdateReviewUseCase - 编辑复盘正文
 * 用户手动修改已生成的复盘内容（AI 草稿只是起点，允许用户改）。
 */
import type { UUID } from '@shared-types/common';
import type { ReviewLog, ReviewRepository } from '../../ports';
import { now } from '../../shared/utils';

export class UpdateReviewUseCase {
  constructor(private readonly reviewRepo: ReviewRepository) {}

  async execute(reviewId: UUID, patch: { content: string }): Promise<ReviewLog> {
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) throw new Error(`复盘不存在: ${reviewId}`);

    const updated: ReviewLog = {
      ...review,
      content: patch.content,
      updatedAt: now(),
    };
    await this.reviewRepo.save(updated);
    return updated;
  }
}
