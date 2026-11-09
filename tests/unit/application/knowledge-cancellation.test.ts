import { describe, expect, it, vi } from 'vitest';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { AskSocraticQuestionUseCase } from '@application/use-cases/socratic/ask-question';
import { CreateKnowledgeLinkUseCase } from '@application/use-cases/knowledge-link/create-link';
import { SuggestKnowledgeLinksUseCase } from '@application/use-cases/knowledge-link/suggest-links';
import { InMemoryActionProposalRepository, InMemoryKnowledgeLinkRepository, InMemoryNoteRepository, InMemorySocraticRepository } from '@infrastructure/local-demo';

describe('cancel knowledge generation before writes', () => {
  it('cancelled retrieval never proposes or writes an association, preserving the imported note', async () => {
    const notes = new InMemoryNoteRepository();
    await notes.save({ id: 'n', title: 'note', content: 'learning', contentHash: 'hash', tags: [], sourceType: 'manual', indexStatus: 'pending', createdAt: '', updatedAt: '' });
    const links = new InMemoryKnowledgeLinkRepository();
    const prompt = vi.fn(async () => true);
    const controller = new AbortController();
    const create = new CreateKnowledgeLinkUseCase(links, new SimpleEventBus(), new ConfirmationService(new InMemoryActionProposalRepository(), prompt));
    const suggest = new SuggestKnowledgeLinksUseCase(notes, links, { suggestForNote: async () => {
      controller.abort();
      return [{ toId: 'other', toType: 'note', relationType: 'extends', reason: 'related', confidence: 1, excerpt: '' }];
    } }, create);
    await expect(suggest.execute('n', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(prompt).not.toHaveBeenCalled();
    expect(await links.query({})).toEqual([]);
    expect(await notes.findById('n')).not.toBeNull();
  });

  it('cancelling association confirmation rejects the proposal and ignores a late approval', async () => {
    const links = new InMemoryKnowledgeLinkRepository();
    const proposals = new InMemoryActionProposalRepository();
    const controller = new AbortController();
    let approve: ((decision: boolean) => void) | undefined;
    const prompt = vi.fn(() => new Promise<boolean>(resolve => { approve = resolve; }));
    const create = new CreateKnowledgeLinkUseCase(links, new SimpleEventBus(), new ConfirmationService(proposals, prompt));
    const waiting = create.executeFromSuggestions([{ fromType: 'note', fromId: 'a', toType: 'note', toId: 'b', relationType: 'extends', reason: 'related' }], { signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    approve?.(true);
    expect(await links.query({})).toEqual([]);
    expect(await proposals.listPending()).toEqual([]);
  });

  it.each(['cancel', 'abandon'] as const)('%s during a Socratic request preserves the user answer without saving a late question', async action => {
    const repo = new InMemorySocraticRepository();
    const session = { id: 's', topic: 'learning', relatedNoteIds: [], status: 'active' as const, createdAt: '', updatedAt: '' };
    await repo.saveSession(session);
    await repo.saveExchange({ id: 'e', sessionId: 's', turnNumber: 1, question: 'why?', createdAt: '' });
    const controller = new AbortController();
    const useCase = new AskSocraticQuestionUseCase(repo, { askQuestion: async () => {
      if (action === 'cancel') controller.abort();
      else await repo.saveSession({ ...session, status: 'abandoned' });
      return { question: 'late question' };
    } });
    await expect(useCase.execute({ sessionId: 's', previousResponse: 'my answer', signal: controller.signal })).rejects.toThrow();
    expect(await repo.listExchanges('s')).toMatchObject([{ id: 'e', userResponse: 'my answer' }]);
    expect(await repo.listExchanges('s')).toHaveLength(1);
    expect((await repo.findSession('s'))?.status).toBe(action === 'cancel' ? 'active' : 'abandoned');
  });
});
