import { describe, expect, it, vi } from 'vitest';
import { AdoptReviewSuggestionUseCase } from '@application/use-cases/review/adopt-review-suggestion';
import { readReviewFollowUps } from '@application/use-cases/review/review-follow-ups';
import { InMemoryReviewRepository, InMemoryTodoRepository, InMemoryActionProposalRepository, TemplateReviewGeneratorPort } from '@infrastructure/local-demo';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { today } from '@application/shared/utils';

describe('复盘建议采用闭环', () => {
  it('浏览器演示也提供证据快照，空记录不凑建议并正确显示月复盘', async () => {
    const draft = await new TemplateReviewGeneratorPort().generate({ reviewType: 'monthly', date: today(), todos: [], focusSessions: [] });
    expect(draft.content).toContain('月复盘');
    expect(draft.nextTodos).toEqual([]);
    expect(draft.evidence?.sources[0].id).toBe('period');
    expect(draft.evidence?.limitations[0]).toContain('程序模板');
  });
  it('明确点击即确认，并发双击只创建一条任务、只发一次创建事件', async () => {
    const todos = new InMemoryTodoRepository();
    const reviews = new InMemoryReviewRepository(todos);
    const proposals = new InMemoryActionProposalRepository();
    await reviews.save({ id: 'r1', reviewType: 'daily', date: today(), content: '复盘', insights: [], nextTodos: ['回顾第三章'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const prompt = vi.fn(async () => false);
    const events = new SimpleEventBus();
    const created = vi.fn(); events.subscribe('TodoConfirmed', created);
    const useCase = new AdoptReviewSuggestionUseCase(reviews, new ConfirmationService(proposals, prompt), events);
    const [first, repeated] = await Promise.all([useCase.execute('r1', '回顾第三章'), useCase.execute('r1', '回顾第三章')]);
    expect(first.todoId).toBe(repeated.todoId);
    expect(await todos.listAll()).toHaveLength(1);
    expect(created).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    const saved = (await todos.listAll())[0];
    await todos.save({ ...saved, status: 'completed', completedAt: new Date().toISOString() });
    expect((await readReviewFollowUps(reviews, today()))[0].status).toBe('completed');
    expect(await readReviewFollowUps(reviews, '2000-01-01')).toEqual([]);
    await todos.delete(saved.id);
    expect((await reviews.listFollowUps())[0].status).toBe('deleted');
    await useCase.execute('r1', '回顾第三章');
    expect(await todos.listAll()).toEqual([]);
  });
});
