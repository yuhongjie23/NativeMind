import type { ReviewRepository, ReviewFollowUp, Todo } from '../../ports';
import type { EventBus } from '../../events/event-bus';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import { newId, now, today } from '../../shared/utils';

export class AdoptReviewSuggestionUseCase {
  constructor(private readonly reviews: ReviewRepository, private readonly confirmation: ConfirmationService, private readonly events: EventBus) {}

  /** 用户已点击具体建议的“创建为任务”，不再弹第二次确认；仍保留建议采用审计。 */
  async execute(reviewId: string, suggestion: string): Promise<ReviewFollowUp> {
    const title = suggestion.trim();
    const review = await this.reviews.findById(reviewId);
    if (!title || !review?.nextTodos.some(item => item.trim() === title)) throw new Error('复盘建议已变化，请刷新后再试。');
    const timestamp = now();
    const todo: Todo = { id: newId(), title, description: `来自 ${review.date} 的复盘建议`, status: 'pending',
      scheduledDate: today(), tags: [], linkedNoteIds: [], createdAt: timestamp, updatedAt: timestamp };
    const { result } = await this.confirmation.confirmAndCommit({
      actionType: 'create_todos', summary: `采用复盘建议：${title}`, payload: { reviewId, suggestion: title }, requiresConfirmation: false,
    }, payload => this.reviews.adoptSuggestion(payload.reviewId, payload.suggestion, todo));
    if (!result) throw new Error('未能采用复盘建议');
    if (result.created) await this.events.publish({ type: 'TodoConfirmed', todoIds: [todo.id], source: 'ai_suggestion', timestamp });
    return result.followUp;
  }
}
