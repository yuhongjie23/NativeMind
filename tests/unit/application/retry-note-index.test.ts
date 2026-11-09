import { describe, expect, it, vi } from 'vitest';
import { RetryNoteIndexUseCase } from '@application/use-cases/note/retry-note-index';
import type { NoteIndexRetryPort } from '@application/ports';

describe('manual note index repair', () => {
  it('reports unsupported in the browser demo instead of pretending to index', async () => {
    expect(await new RetryNoteIndexUseCase().execute('note')).toBe('unsupported');
  });
  it.each(['queued', 'busy', 'missing', 'empty'] as const)('handles %s without a second write confirmation', async result => {
    const retryIndex = vi.fn<NoteIndexRetryPort['retryIndex']>(async () => result);
    const useCase = new RetryNoteIndexUseCase({ retryIndex });
    if (result === 'missing' || result === 'empty') await expect(useCase.execute('note')).rejects.toThrow();
    else expect(await useCase.execute('note')).toBe(result);
    expect(retryIndex).toHaveBeenCalledExactlyOnceWith('note');
  });
});
