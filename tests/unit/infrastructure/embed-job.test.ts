import { describe, expect, it, vi } from 'vitest';
import type { Note } from '@application/ports';
import type { NoteChunk } from '@infrastructure/db/repositories/note-repository';
import { EmbedChunksJob } from '@infrastructure/background-jobs/embed-job';
import type { Job } from '@infrastructure/background-jobs/job-queue';

const job: Job = { id: 'job', entityId: 'note', type: 'embed_chunks', status: 'pending', payload: {}, retryCount: 0, maxRetries: 3, createdAt: '' };
function setup() {
  const notes = {
    findById: vi.fn(async () => ({ id: 'note' } as Note)),
    listChunks: vi.fn(async () => [{ id: 'chunk', noteId: 'note', text: '正文' } as NoteChunk]),
    updateIndexStatus: vi.fn(async () => undefined),
  };
  const embedding = { version: 'test', embed: vi.fn(async () => [[1, 0]]) };
  const store = { name: 'test', dimension: 2, didRebuild: false, isAvailable: vi.fn(async () => true), upsert: vi.fn(async () => undefined), query: vi.fn(async () => []), deleteByNote: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  const onIndexed = vi.fn();
  return { notes, embedding, store, onIndexed, handler: new EmbedChunksJob(notes, embedding, store, { onIndexed }) };
}

describe('embedding completion integrity', () => {
  it('preemption does not write late vectors or mark the note failed', async () => {
    const f = setup();
    const controller = new AbortController();
    f.embedding.embed.mockImplementation(async () => { controller.abort(); return [[1, 0]]; });
    await expect(f.handler.run(job, controller.signal)).rejects.toThrow();
    expect(f.store.upsert).not.toHaveBeenCalled();
    expect(f.onIndexed).not.toHaveBeenCalled();
    expect(f.notes.updateIndexStatus).not.toHaveBeenCalledWith('note', 'failed', expect.anything());
    f.embedding.embed.mockResolvedValue([[1, 0]]);
    await f.handler.run(job);
    expect(f.onIndexed).toHaveBeenCalledTimes(1);
  });
  it.each([[], [[]], [[0, 0]], [[Number.NaN, 1]], [[1, 0], [0, 1]]])('rejects incomplete or invalid output %#', async (...rows) => {
    const f = setup();
    f.embedding.embed.mockResolvedValue(rows as number[][]);
    await expect(f.handler.run(job)).rejects.toThrow('向量缺失或无效');
    expect(f.store.upsert).not.toHaveBeenCalled();
    expect(f.notes.updateIndexStatus).toHaveBeenLastCalledWith('note', 'failed', { error: expect.any(String) });
    expect(f.onIndexed).not.toHaveBeenCalled();
  });
  it('records a write error and succeeds only after a complete retry', async () => {
    const f = setup();
    f.store.upsert.mockRejectedValueOnce(new Error('disk failure'));
    await expect(f.handler.run(job)).rejects.toThrow('disk failure');
    expect(f.notes.updateIndexStatus).toHaveBeenLastCalledWith('note', 'failed', { error: 'disk failure' });
    expect(f.onIndexed).not.toHaveBeenCalled();
    await f.handler.run(job);
    expect(f.notes.updateIndexStatus).toHaveBeenLastCalledWith('note', 'indexed', { chunkCount: 1, embeddingVersion: 'test' });
    expect(f.onIndexed).toHaveBeenCalledTimes(1);
  });
});
