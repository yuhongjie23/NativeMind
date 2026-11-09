import { describe, expect, it, vi } from 'vitest';
import { AskNotesUseCase, emptyAskNotesAnswer } from '@application/use-cases/note/ask-notes';
import { SearchNotesUseCase } from '@application/use-cases/note/search-notes';
import { PrivacyPolicy } from '@application/policies/privacy-policy';
import { FocusModePolicy } from '@application/policies/focus-mode-policy';

describe('interactive indexing priority', () => {
  it.each(['success', 'failure', 'cancel'] as const)('releases background pause on ask %s', async mode => {
    const release = vi.fn();
    const jobs = { enqueue: vi.fn(), prioritizeInteractive: vi.fn(() => release) };
    const controller = new AbortController();
    const useCase = new AskNotesUseCase({ ask: async () => {
      expect(jobs.prioritizeInteractive).toHaveBeenCalledOnce();
      if (mode === 'cancel') controller.abort();
      if (mode !== 'success') throw new Error('stopped');
      return emptyAskNotesAnswer;
    } }, emptyAskNotesAnswer, jobs);
    const work = useCase.execute('question', { signal: controller.signal });
    if (mode === 'cancel') await expect(work).rejects.toThrow();
    else await work;
    expect(release).toHaveBeenCalledOnce();
  });

  it('also releases a failed search and skips acquiring for empty input', async () => {
    const release = vi.fn();
    const jobs = { enqueue: vi.fn(), prioritizeInteractive: vi.fn(() => release) };
    const search = new SearchNotesUseCase({ search: async () => { throw new Error('offline'); } }, new PrivacyPolicy(), new FocusModePolicy(), undefined, 3, jobs);
    await search.execute('');
    expect(jobs.prioritizeInteractive).not.toHaveBeenCalled();
    await expect(search.execute('text')).rejects.toThrow('offline');
    expect(release).toHaveBeenCalledOnce();
  });
});
