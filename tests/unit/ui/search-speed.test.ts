import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskNotesQuestion, NoteSearchOptions, SearchHit } from '@application/ports';
import type { SearchNotesResult } from '@application/use-cases/note/search-notes';
import { emptyAskNotesAnswer } from '@application/use-cases/note/ask-notes';

const mocks = vi.hoisted(() => ({ search: vi.fn(), ask: vi.fn(), enhance: vi.fn(), saveAsk: vi.fn() }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { searchNotes: { execute: mocks.search }, askNotes: { execute: mocks.ask }, enhanceSearchResults: { execute: mocks.enhance }, saveAskSession: { execute: mocks.saveAsk } },
  repositories: { settings: { set: async () => undefined } }, ai: {}, aiMode: 'model', describeError: String,
}));
import { useNoteStore } from '@ui/stores/note-store';

const hit = (id: string): SearchHit => ({ chunkId: id, noteId: 'n', text: id, score: 1 });
const result = (id: string): SearchNotesResult => ({ hits: [hit(id)], externalResults: [], externalQueries: [], externalSearchAvailable: false, externalSearchAttempted: false, confirmationRequired: false });

describe('search latency UI state', () => {
  beforeEach(() => {
    useNoteStore.getState().clearSearch();
    useNoteStore.setState({ history: [], notes: [], deep: false });
    vi.clearAllMocks();
  });

  it.each(['changed', 'unavailable'] as const)('discards the streamed draft and does not save a %s source failure as an answer', async sourceIssue => {
    mocks.ask.mockImplementation(async (_question, options: AskNotesQuestion) => {
      options.onToken?.('Old answer preview');
      return { ...emptyAskNotesAnswer, empty: false, sourceIssue, answer: 'Please retry with current sources.' };
    });
    await useNoteStore.getState().askQuestion('question');
    expect(useNoteStore.getState()).toMatchObject({ asking: false, streamingAnswer: '', deepAnswer: { sourceIssue, citations: [] } });
    expect(mocks.saveAsk).not.toHaveBeenCalled();
  });

  it('shows keyword results while waiting, cancels old search and ignores its late callbacks', async () => {
    let oldOptions: NoteSearchOptions | undefined;
    let finish!: (value: SearchNotesResult) => void;
    mocks.search.mockImplementationOnce((_q, _l, _t, _d, options: NoteSearchOptions) => {
      oldOptions = options;
      options.onPartial?.([hit('early')]);
      return new Promise<SearchNotesResult>(resolve => { finish = resolve; });
    });
    const old = useNoteStore.getState().search('old');
    expect(useNoteStore.getState()).toMatchObject({ searching: true, hits: [hit('early')], searchKeywordReady: true });
    mocks.search.mockResolvedValueOnce(result('new'));
    await useNoteStore.getState().search('new');
    expect(oldOptions?.signal?.aborted).toBe(true);
    oldOptions?.onPartial?.([hit('late')]);
    oldOptions?.onProgress?.({ stage: 'rerank', state: 'running' });
    finish(result('old'));
    await old;
    expect(useNoteStore.getState()).toMatchObject({ hits: [hit('new')], searching: false, searchProgress: [] });
    expect(mocks.enhance).not.toHaveBeenCalled();
  });

  it('keeps keyword hits on semantic failure and clears them on explicit clear', async () => {
    mocks.search.mockImplementationOnce((_q, _l, _t, _d, options: NoteSearchOptions) => {
      options.onPartial?.([hit('early')]);
      return Promise.reject(new Error('connection lost'));
    });
    await useNoteStore.getState().search('needle');
    expect(useNoteStore.getState()).toMatchObject({ hits: [hit('early')], searching: false });
    useNoteStore.getState().clearSearch();
    expect(useNoteStore.getState()).toMatchObject({ hits: [], searchProgress: [], askProgress: [] });
  });

  it('question follows the depth choice, records progress and ignores stopped tokens', async () => {
    let options: AskNotesQuestion | undefined;
    let finish!: (value: typeof emptyAskNotesAnswer) => void;
    mocks.ask.mockImplementation((_q, supplied) => { options = supplied; return new Promise(resolve => { finish = resolve; }); });
    const work = useNoteStore.getState().askQuestion('question');
    expect(options?.deep).toBe(false);
    options?.onProgress?.({ stage: 'generating', state: 'running' });
    options?.onToken?.('answer');
    expect(useNoteStore.getState().firstTokenMs).toBeTypeOf('number');
    expect(useNoteStore.getState().askProgress).toEqual([{ stage: 'generating', state: 'running' }]);
    useNoteStore.getState().cancelQuestion();
    options?.onToken?.('late');
    finish(emptyAskNotesAnswer);
    await work;
    expect(useNoteStore.getState()).toMatchObject({ asking: false, streamingAnswer: '', deepAnswer: null });
    expect(options?.signal?.aborted).toBe(true);
  });
});
