import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskNotesAnswer } from '@application/ports';

const mocks = vi.hoisted(() => ({ ask: vi.fn(), save: vi.fn() }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { askNotes: { execute: mocks.ask }, saveAskSession: { execute: mocks.save } },
  repositories: {}, ai: {}, aiMode: 'model', describeError: String,
}));
vi.mock('../../../src/ui/stores/knowledge-link-store', () => ({ useKnowledgeLinkStore: {} }));
import { useNoteStore } from '../../../src/ui/stores/note-store';

const answer: AskNotesAnswer = { answer: 'late answer', citations: [], confidence: 1, judged: true, regenerated: false, empty: false, ok: true };

describe('note question cancellation', () => {
  beforeEach(() => { useNoteStore.getState().clearSearch(); vi.clearAllMocks(); });
  it.each(['cancelQuestion', 'clearSearch'] as const)('%s aborts work and prevents late preview/history writes', async (action) => {
    let signal: AbortSignal | undefined;
    let finish: ((answer: AskNotesAnswer) => void) | undefined;
    let preview: ((delta: string) => void) | undefined;
    mocks.ask.mockImplementation((_q, options) => {
      signal = options.signal;
      preview = options.onToken;
      preview?.('第一段');
      return new Promise<AskNotesAnswer>(resolve => { finish = resolve; });
    });
    const waiting = useNoteStore.getState().askQuestion('question');
    expect(useNoteStore.getState().streamingAnswer).toBe('第一段');
    useNoteStore.getState()[action]();
    expect(signal?.aborted).toBe(true);
    preview?.('late');
    finish?.(answer);
    await waiting;
    expect(useNoteStore.getState()).toMatchObject({ asking: false, streamingAnswer: '', deepAnswer: null });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
