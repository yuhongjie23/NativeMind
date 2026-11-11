import { describe, expect, it, vi } from 'vitest';
import { SearchNotesUseCase } from '@application/use-cases/note/search-notes';
import { PrivacyPolicy } from '@application/policies/privacy-policy';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';
import type { SearchGate } from '@ai/search/search-gate';

const setup = (exactTitleMatch: boolean, requireConfirmationPerRequest = true) => {
  const search = vi.fn(async () => ({ allowed: true, results: [], queries: ['tea'] }));
  const gate = { search } as unknown as SearchGate;
  const useCase = new SearchNotesUseCase({ search: async () => [{
    chunkId: 'tea-chunk', noteId: 'tea', text: 'Saved tea note', score: 1, exactTitleMatch,
  }] }, new PrivacyPolicy({ allowExternalSearch: true, requireConfirmationPerRequest }), new FocusModePolicy(), gate);
  return { search, useCase };
};

describe('exact title search does not need a web supplement', () => {
  it.each([true, false])('does not suggest or invoke external search with per-request confirmation %s', async confirmation => {
    const { search, useCase } = setup(true, confirmation);
    const result = await useCase.execute('tea');
    expect(result.hits).toHaveLength(1);
    expect(result.confirmationRequired).toBe(false);
    expect(result.externalSearchAttempted).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('does not confuse a high similarity score with an exact title match', async () => {
    const { search, useCase } = setup(false);
    expect((await useCase.execute('tea')).confirmationRequired).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('still honors an explicit confirmed request to search the web', async () => {
    const { search, useCase } = setup(true);
    expect((await useCase.executeWithConfirmation('tea')).externalSearchAttempted).toBe(true);
    expect(search).toHaveBeenCalledOnce();
  });
});
