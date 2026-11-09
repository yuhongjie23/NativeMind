import type { ReviewRepository, ReviewFollowUp } from '../../ports';
import { today } from '../../shared/utils';

export async function readReviewFollowUps(repository: ReviewRepository, date: string): Promise<ReviewFollowUp[]> {
  // 目前保存的是当前状态，无法还原任意历史时点；旧日期复盘不引用这些状态。
  if (date !== today()) return [];
  return repository.listFollowUps(20);
}
