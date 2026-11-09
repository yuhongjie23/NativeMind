import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@application/ports';
const mocks = vi.hoisted(() => ({ retry: vi.fn(), find: vi.fn(), show: vi.fn() }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { retryNoteIndex: { execute: mocks.retry } }, repositories: { note: { findById: mocks.find } },
  ai: {}, aiMode: 'model', describeError: String,
}));
vi.mock('../../../src/ui/stores/toast-store', () => ({ useToastStore: { getState: () => ({ show: mocks.show }) } }));
import { useNoteStore } from '@ui/stores/note-store';

const note = { id: 'note', content: 'saved', indexStatus: 'failed', indexError: 'model missing' } as Note;
describe('index retry controls', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useNoteStore.setState({ notes: [note], retryingIndex: {}, error: undefined });
  });
  it('coalesces double clicks and refreshes only the selected index state', async () => {
    let finish!: (value: string) => void;
    mocks.retry.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.find.mockResolvedValue({ ...note, content: 'older read', indexStatus: 'pending', indexError: undefined });
    const first = useNoteStore.getState().retryIndex('note');
    await useNoteStore.getState().retryIndex('note');
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    finish('queued');
    await first;
    expect(useNoteStore.getState().notes[0]).toMatchObject({ content: 'saved', indexStatus: 'pending', indexError: undefined });
    expect(useNoteStore.getState().retryingIndex).toEqual({});
  });
  it('keeps the saved note and allows another attempt after an error', async () => {
    mocks.retry.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce('busy');
    mocks.find.mockResolvedValue(note);
    await useNoteStore.getState().retryIndex('note');
    expect(useNoteStore.getState().notes).toEqual([note]);
    expect(useNoteStore.getState().retryingIndex).toEqual({});
    expect(useNoteStore.getState().error).toContain('disk full');
    await useNoteStore.getState().retryIndex('note');
    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(mocks.show).toHaveBeenCalledWith('这篇笔记已有索引任务，无需重复提交。', 'info');
  });
  it('ignores a poll that finishes after a retry refresh', async () => {
    let finishOld!: (value: Note) => void;
    mocks.find.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const old = useNoteStore.getState().refreshIndex('note');
    mocks.retry.mockResolvedValue('queued');
    mocks.find.mockResolvedValue({ ...note, indexStatus: 'pending', indexError: undefined });
    await useNoteStore.getState().retryIndex('note');
    finishOld(note);
    await old;
    expect(useNoteStore.getState().notes[0].indexStatus).toBe('pending');
  });
  it('does not restore a deleted note when an old status read completes', async () => {
    let finish!: (value: Note) => void;
    mocks.find.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const refresh = useNoteStore.getState().refreshIndex('note');
    useNoteStore.setState({ notes: [] });
    finish(note);
    await refresh;
    expect(useNoteStore.getState().notes).toEqual([]);
  });
});
