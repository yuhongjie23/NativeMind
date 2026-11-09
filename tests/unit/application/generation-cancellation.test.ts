import { describe, expect, it, vi } from 'vitest';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';
import { GenerateDailyReviewUseCase } from '@application/use-cases/review/generate-daily-review';
import { GenerateWeeklyReviewUseCase } from '@application/use-cases/review/generate-weekly-review';
import { GenerateMonthlyReviewUseCase } from '@application/use-cases/review/generate-monthly-review';
import { CreateTodoUseCase } from '@application/use-cases/todo/create-todo';
import { InMemoryActionProposalRepository, InMemoryTodoRepository, InMemoryFocusRepository, InMemoryReviewRepository } from '@infrastructure/local-demo';
import type { ReviewDraft } from '@application/ports';

const draft: ReviewDraft = { content: 'generated draft', summary: 'summary', insights: [], nextTodos: [] };

describe('cancel generation before business writes', () => {
  it.each([GenerateDailyReviewUseCase, GenerateWeeklyReviewUseCase, GenerateMonthlyReviewUseCase])('%s discards a late draft without creating a proposal', async (Review) => {
    const controller = new AbortController();
    const proposals = new InMemoryActionProposalRepository();
    const reviews = new InMemoryReviewRepository();
    const prompt = vi.fn(async () => true);
    const generator = { generate: vi.fn(async (_input, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return draft; // Even a port that ignores abort cannot write this result.
    }) };
    const useCase = new Review(reviews, new InMemoryTodoRepository(), new InMemoryFocusRepository(), generator,
      new ConfirmationService(proposals, prompt), new SimpleEventBus(), new FocusModePolicy());
    await expect(useCase.execute({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(prompt).not.toHaveBeenCalled();
    expect(await reviews.listAll()).toEqual([]);
    expect(await proposals.listPending()).toEqual([]);
  });

  it('stopping task splitting preserves the manually saved original and never writes suggestions', async () => {
    const controller = new AbortController();
    const todos = new InMemoryTodoRepository();
    const proposals = new InMemoryActionProposalRepository();
    const structure = vi.fn(async (_goal, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return [{ title: 'must not appear' }];
    });
    const useCase = new CreateTodoUseCase(todos, new SimpleEventBus(), new ConfirmationService(proposals, async () => true), { structure });
    const original = await useCase.execute({ title: 'original task' });
    await expect(useCase.structureGoal('original task', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await todos.listAll()).toEqual([original]);
    expect(await proposals.listPending()).toEqual([]);
  });

  it('aborting a waiting confirmation rejects its persisted proposal and ignores a late approval', async () => {
    const controller = new AbortController();
    const proposals = new InMemoryActionProposalRepository();
    let approve: ((value: boolean) => void) | undefined;
    let proposalId = '';
    const prompt = vi.fn(proposal => { proposalId = proposal.id; return new Promise<boolean>(resolve => { approve = resolve; }); });
    const commit = vi.fn(async () => 'saved');
    const waiting = new ConfirmationService(proposals, prompt).confirmAndCommit({ actionType: 'generate_review', summary: 'draft', payload: draft }, commit, { signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    approve?.(true);
    expect(commit).not.toHaveBeenCalled();
    expect(await proposals.findById(proposalId)).toMatchObject({ status: 'rejected' });
    expect(await proposals.listPending()).toEqual([]);
  });

  it('normal confirmation still commits exactly once and announces persistence before writing', async () => {
    const order: string[] = [];
    const proposals = new InMemoryActionProposalRepository();
    const result = await new ConfirmationService(proposals, async () => true).confirmAndCommit(
      { actionType: 'generate_review', summary: 'draft', payload: draft },
      async () => { order.push('save'); return 'saved'; },
      { onCommit: () => order.push('commit-start') },
    );
    expect(order).toEqual(['commit-start', 'save']);
    expect(result).toMatchObject({ confirmed: true, result: 'saved' });
    expect(await proposals.findById(result.proposalId)).toMatchObject({ status: 'confirmed' });
  });
});
