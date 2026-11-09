import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationOptions, SearchResultEnhancement } from '@application/ports';

const mocks = vi.hoisted(() => ({ enhance: vi.fn(), digest: vi.fn(), suggest: vi.fn() }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { enhanceSearchResults: { execute: mocks.enhance }, suggestKnowledgeLinks: { execute: mocks.suggest } },
  repositories: {}, ai: { ports: { noteDigest: { summarizeMonth: mocks.digest } } }, aiMode: 'model', describeError: String,
}));
import { useNoteStore } from '@ui/stores/note-store';
import { useKnowledgeLinkStore } from '@ui/stores/knowledge-link-store';

describe('knowledge generation controls', () => {
  beforeEach(() => {
    useNoteStore.getState().clearSearch();
    useNoteStore.getState().cancelDigest('2026-11');
    useKnowledgeLinkStore.getState().cancelSuggestions();
    vi.clearAllMocks();
    useNoteStore.setState({ query: 'learning', hits: [{ chunkId: 'c', noteId: 'n', text: 'note', score: 1 }] });
  });

  it.each(['clearSearch', 'cancelEnhancement'] as const)('%s prevents late summaries overwriting a newer run', async action => {
    let finish: ((result: SearchResultEnhancement[]) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    mocks.enhance.mockImplementationOnce(input => { oldSignal = input.signal; return new Promise(resolve => { finish = resolve; }); });
    const old = useNoteStore.getState().enhanceResults();
    useNoteStore.getState()[action]();
    expect(oldSignal?.aborted).toBe(true);
    useNoteStore.setState({ query: 'new', hits: [{ chunkId: 'new', noteId: 'n', text: 'new', score: 1 }] });
    mocks.enhance.mockResolvedValueOnce([{ id: 'new', summary: 'new summary', rank: 1 }]);
    await useNoteStore.getState().enhanceResults();
    finish?.([{ id: 'old', summary: 'late', rank: 1 }]);
    await old;
    expect(useNoteStore.getState().enhancements).toEqual({ new: { id: 'new', summary: 'new summary', rank: 1 } });
    expect(useNoteStore.getState().enhancing).toBe(false);
  });

  it('month cancellation stops the caller even if its port ignores abort and ignores late tokens', async () => {
    let options: GenerationOptions | undefined;
    mocks.digest.mockImplementation((_notes, _month, supplied) => { options = supplied; return new Promise(() => {}); });
    const waiting = useNoteStore.getState().summarizeMonth('2026-11', []);
    options?.onToken?.('preview');
    useNoteStore.getState().cancelDigest('2026-11');
    options?.onToken?.('late');
    await waiting;
    expect(options?.signal?.aborted).toBe(true);
    expect(useNoteStore.getState().digests['2026-11']).toEqual({ text: '已停止生成', loading: false });
  });

  it('stopped association completing late does not clear the next request or show a false empty result', async () => {
    let finish: (() => void) | undefined;
    mocks.suggest.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const old = useKnowledgeLinkStore.getState().suggestForNote('n');
    useKnowledgeLinkStore.getState().cancelSuggestions();
    let finishNew: ((value: { suggested: number; created: [] }) => void) | undefined;
    mocks.suggest.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const next = useKnowledgeLinkStore.getState().suggestForNote('n');
    finish?.();
    expect(await old).toMatchObject({ cancelled: true });
    expect(useKnowledgeLinkStore.getState().suggesting).toBe(true);
    finishNew?.({ suggested: 0, created: [] });
    await next;
    expect(useKnowledgeLinkStore.getState().suggesting).toBe(false);
  });

  it('duplicate association is skipped and confirmed saving cannot be cancelled', async () => {
    let signal: AbortSignal | undefined;
    let finish: ((value: { suggested: number; created: [] }) => void) | undefined;
    mocks.suggest.mockImplementation((_id, options) => {
      signal = options.signal; options.onCommit();
      return new Promise(resolve => { finish = resolve; });
    });
    const waiting = useKnowledgeLinkStore.getState().suggestForNote('n');
    expect(await useKnowledgeLinkStore.getState().suggestForNote('n')).toMatchObject({ skipped: true });
    useKnowledgeLinkStore.getState().cancelSuggestions();
    expect(signal?.aborted).toBe(false);
    expect(useKnowledgeLinkStore.getState()).toMatchObject({ suggesting: true, canCancelSuggestions: false });
    finish?.({ suggested: 0, created: [] });
    await waiting;
  });
});
