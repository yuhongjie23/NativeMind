import type { LearningRepository, ReviewRepository } from '../../ports';
import type { GenerateDailyReviewUseCase } from '../review/generate-daily-review';
import type { ManageRemindersUseCase } from './manage-reminders';

export class ReviewLearningUseCase {
  constructor(private readonly repo: LearningRepository, private readonly reviews: ReviewRepository,
    private readonly daily: GenerateDailyReviewUseCase, private readonly reminders: ManageRemindersUseCase) {}
  async execute(id: string, options: { signal?: AbortSignal; onCommit?: () => void } = {}) {
    const reminder = await this.repo.findReminder(id);
    if (!reminder || reminder.state !== 'scheduled') throw new Error('提醒已经结束。');
    const previous = reminder.reviewId ? await this.reviews.findById(reminder.reviewId) : (await this.reviews.listAll(1))[0];
    if (reminder.reviewId && !previous) throw new Error('关联复盘已删除，请重新创建提醒并选择现有复盘。');
    const knowledge = reminder.knowledgeId ? await this.repo.findKnowledge(reminder.knowledgeId) : null;
    const followUps = (await this.reviews.listFollowUps()).filter(item => !previous || item.reviewId === previous.id);
    const context = JSON.stringify({
      purpose: '本次由用户点击提醒后发起复盘；不自动创建或修改任务。自评是用户报告，不是测验分数。',
      reminder: reminder.title,
      knowledge: knowledge ? { title: knowledge.title, recentSelfReports: knowledge.observations.slice(-3).map(entry => ({
        at: entry.at, rating: entry.rating, difficulty: entry.difficulty.slice(0, 60), result: entry.result.slice(0, 60),
      })) } : '未关联知识自评',
      // Historical model prose is not a new observation about the user.
      previousReview: previous ? { date: previous.date, suggestions: previous.nextTodos.slice(0, 3).map(item => item.slice(0, 80)),
        provenance: '历史建议，不代表已经执行；执行状态仅以 learningFollowUps 为据' } : '没有上次复盘',
    });
    const result = await this.daily.execute({ ...options, learningContext: context, learningFollowUps: followUps });
    // A cancelled draft does not resolve the reminder. Respect concurrent snooze/stop.
    if (result && (await this.repo.findReminder(id))?.revision === reminder.revision) {
      await this.reminders.act(id, 'complete', reminder.revision);
    }
    return result;
  }
}
