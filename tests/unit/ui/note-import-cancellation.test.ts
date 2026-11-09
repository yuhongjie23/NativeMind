import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteImportOptions } from '@application/ports';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), refresh: vi.fn(), suggest: vi.fn() }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { importNote: { execute: mocks.execute } }, repositories: {}, ai: {}, aiMode: 'model', describeError: String,
}));
import { useNoteStore } from '@ui/stores/note-store';

describe('note import lifecycle', () => {
  beforeEach(() => {
    useNoteStore.getState().cancelImport();
    vi.clearAllMocks();
    useNoteStore.setState({ importPhase: 'idle', importOutcome: undefined, error: undefined, refresh: mocks.refresh, suggestLinksForNote: mocks.suggest });
  });

  it('does not link a late cancelled note or clear a newer request', async () => {
    let oldFinish!: (note: Note) => void;
    let newFinish!: (note: Note) => void;
    let options!: NoteImportOptions;
    mocks.execute.mockImplementationOnce((_source, opts) => { options = opts; return new Promise(resolve => { oldFinish = resolve; }); });
    const old = useNoteStore.getState().importNote({ kind: 'text', content: 'old' });
    useNoteStore.getState().cancelImport();
    expect(options.signal?.aborted).toBe(true);
    mocks.execute.mockImplementationOnce(() => new Promise(resolve => { newFinish = resolve; }));
    const next = useNoteStore.getState().importNote({ kind: 'text', content: 'next' });
    oldFinish({ id: 'old' } as Note);
    expect(await old).toBe('cancelled');
    expect(useNoteStore.getState().importPhase).toBe('parsing');
    expect(mocks.suggest).not.toHaveBeenCalled();
    newFinish({ id: 'new' } as Note);
    expect(await next).toBe('imported');
    expect(mocks.suggest).toHaveBeenCalledExactlyOnceWith('new');
  });

  it('rejects duplicate starts and does not cancel saving', async () => {
    let finish!: (note: Note) => void;
    let options!: NoteImportOptions;
    mocks.execute.mockImplementationOnce((_source, opts) => { options = opts; opts.onPhase('saving'); return new Promise(resolve => { finish = resolve; }); });
    const pending = useNoteStore.getState().importNote({ kind: 'text', content: 'first' });
    expect(await useNoteStore.getState().importNote({ kind: 'text', content: 'second' })).toBe('busy');
    useNoteStore.getState().cancelImport();
    expect(options.signal?.aborted).toBe(false);
    finish({ id: 'saved' } as Note);
    expect(await pending).toBe('imported');
  });

  it('reports failure so callers preserve their draft and does not start associations', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('parse failed'));
    expect(await useNoteStore.getState().importNote({ kind: 'text', content: 'draft' })).toBe('failed');
    expect(useNoteStore.getState().error).toContain('parse failed');
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('propagates failed and busy external imports instead of claiming they were saved', async () => {
    const result = { title: 'External test', url: 'https://example.com', score: 1 };
    mocks.execute.mockRejectedValueOnce(new Error('save failed'));
    expect(await useNoteStore.getState().importExternalResult(result)).toBe('failed');
    useNoteStore.setState({ importPhase: 'saving' });
    expect(await useNoteStore.getState().importExternalResult(result)).toBe('busy');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    useNoteStore.setState({ importPhase: 'idle' });
  });

  it('reports an existing note without suggesting links again', async () => {
    mocks.execute.mockImplementationOnce((_source, options: NoteImportOptions) => {
      options.onDuplicate?.();
      return { id: 'existing' };
    });
    expect(await useNoteStore.getState().importNote({ kind: 'text', content: 'same' })).toBe('imported');
    expect(useNoteStore.getState().importOutcome).toContain('已有相同内容');
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
});
