import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NoteCandidateProvider } from '@infrastructure/rag/note-candidate-provider';
import { RetrievalStrategy } from '@ai/rag/retrieval-strategy';
import { EmbedChunksJob } from '@infrastructure/background-jobs/embed-job';
import { ChunkNoteJob } from '@infrastructure/background-jobs/chunk-note-job';
import { ParseNoteJob } from '@infrastructure/background-jobs/parse-note-job';
import { JobQueue, type Job } from '@infrastructure/background-jobs/job-queue';
import { currentVectorMatches } from '@infrastructure/vector-store/current-vector-matches';
import { ChromaProvider } from '@infrastructure/vector-store/chroma-provider';
import type { Note } from '@application/ports';
import { NodeSqliteDriver } from './sqlite-driver';

const drivers: NodeSqliteDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map(driver => driver.close())); });
const original: Note = { id: 'lab', title: '实验记录', content: '旧记录：提取率为百分之二十。', contentHash: 'old',
  indexStatus: 'indexed', sourceType: 'manual', tags: [], createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z' };
const edited: Note = { ...original, content: '更正记录：研究溶解度。', contentHash: 'new', indexStatus: 'stale' };
const job: Job = { id: 'job', entityId: 'lab', type: 'embed_chunks', status: 'pending', payload: {}, retryCount: 0, maxRetries: 3, createdAt: '' };
const chunk = (note: Note, id = 'old-chunk') => ({ id, noteId: note.id, text: note.content, charStart: 0,
  charEnd: note.content.length, headingPath: [], tags: [], createdAt: note.createdAt });
const setup = async () => {
  const driver = new NodeSqliteDriver(':memory:');
  drivers.push(driver);
  const db = new Database(driver);
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  await repo.save(original);
  await repo.replaceChunks(original.id, [chunk(original)]);
  const provider = new NoteCandidateProvider(repo);
  const strategy = new RetrievalStrategy({ version: 'test', embed: async () => [] }, { query: async () => [] });
  const search = async (text: string) => {
    const query = { text, preferLiteralMatches: true, rerank: false };
    return strategy.retrieve(query, await provider.listCandidates(query, 10), 10);
  };
  return { driver, db, repo, search };
};
const vectorStore = () => ({ name: 'test', dimension: 2, didRebuild: false, isAvailable: async () => true,
  upsert: vi.fn(async () => {}), query: async () => [], deleteByNote: async () => {}, clear: async () => {} });

describe('saved note / derived index consistency', () => {
  it('searches current text immediately after an edit, before any background job runs', async () => {
    const { repo, search } = await setup();
    await repo.save(edited);
    expect((await search(original.title))[0].text).toBe(edited.content);
    expect(await search('提取率')).toEqual([]);
    expect((await search('溶解度'))[0].text).toBe(edited.content);
    expect(await repo.listChunks(original.id)).toEqual([]);
    expect((await repo.findById(original.id))?.indexStatus).toBe('stale');
  });

  it('retains chunks for title-only changes but invalidates content changes even if a caller reuses the hash', async () => {
    const { repo } = await setup();
    await repo.save({ ...original, title: '新标题' });
    expect(await repo.listChunks(original.id)).toHaveLength(1);
    await repo.save({ ...original, content: edited.content });
    expect(await repo.listChunks(original.id)).toEqual([]);
    expect((await repo.findById(original.id))?.indexStatus).toBe('stale');
  });

  it('does not write late embedding results or announce completion after an edit', async () => {
    const { repo } = await setup();
    const store = vectorStore();
    const onIndexed = vi.fn();
    const embeddings = { version: 'test', embed: async () => { await repo.save(edited); return [[1, 0]]; } };
    await new EmbedChunksJob(repo, embeddings, store, { onIndexed }).run(job);
    expect(store.upsert).not.toHaveBeenCalled();
    expect(onIndexed).not.toHaveBeenCalled();
    expect((await repo.findById(original.id))?.indexStatus).toBe('stale');
  });

  it('rejects old chunk/status commits even after editing A to B and back to A', async () => {
    const { repo } = await setup();
    const oldSnapshot = (await repo.findForIndex('lab'))!;
    await repo.save(edited);
    await repo.save(original);
    expect((await repo.findForIndex('lab'))?.revision).toBe(2);
    expect(await repo.replaceChunks('lab', [chunk(original)], oldSnapshot)).toBe(false);
    expect(await repo.updateIndexStatus('lab', 'indexed', {}, oldSnapshot)).toBe(false);
    expect(await repo.listChunks('lab')).toEqual([]);
    await repo.delete('lab');
    expect(await repo.replaceChunks('lab', [chunk(original)], { revision: 2 })).toBe(false);
  });

  it('rolls back body, chunks, full-text index and revision together when saving fails', async () => {
    const { db, repo } = await setup();
    await expect(db.transaction(async tx => {
      await new SqliteNoteRepository(new Database(tx)).save(edited);
      throw new Error('simulated disk error');
    })).rejects.toThrow('simulated disk error');
    expect((await repo.findById('lab'))?.content).toBe(original.content);
    expect((await repo.findForIndex('lab'))?.revision).toBe(0);
    expect(await repo.searchChunks('提取率')).toHaveLength(1);
    expect(await repo.searchChunks('溶解度')).toEqual([]);
  });

  it('does not replace newly edited text with a late chunking result', async () => {
    const { db, repo } = await setup();
    const update = repo.updateIndexStatus.bind(repo);
    vi.spyOn(repo, 'updateIndexStatus').mockImplementation(async (...args) => {
      const changed = await update(...args);
      if (args[1] === 'chunking') await repo.save(edited);
      return changed;
    });
    const queue = new JobQueue(db);
    await new ChunkNoteJob(repo, queue).run({ ...job, type: 'chunk_note' });
    expect(await repo.listChunks('lab')).toEqual([]);
    expect(await queue.listPending()).toEqual([]);
    expect((await repo.findById('lab'))?.content).toBe(edited.content);
  });

  it('does not mark an edited note indexed when editing occurs during vector storage', async () => {
    const { db, repo } = await setup();
    const store = vectorStore();
    store.upsert.mockImplementation(async () => { await repo.save(edited); });
    const onIndexed = vi.fn();
    await new EmbedChunksJob(repo, { version: 'test', embed: async () => [[1, 0]] }, store, { onIndexed }).run(job);
    expect(onIndexed).not.toHaveBeenCalled();
    expect((await repo.findById('lab'))?.indexStatus).toBe('stale');
    expect(await currentVectorMatches(db, [{ chunkId: 'old-chunk', noteId: 'lab', text: original.content, score: 1 }])).toEqual([]);
  });

  it('does not overwrite a newer edit with an obsolete embedding failure', async () => {
    const { repo } = await setup();
    const embed = async () => { await repo.save(edited); throw new Error('old model failure'); };
    await new EmbedChunksJob(repo, { version: 'test', embed }, vectorStore()).run(job);
    expect(await repo.findById('lab')).toMatchObject({ content: edited.content, indexStatus: 'stale', indexError: undefined });
  });

  it('rejects an obsolete chunk set even when the body revision has not changed', async () => {
    const { repo } = await setup();
    const store = vectorStore();
    const embed = async () => { await repo.replaceChunks('lab', [chunk(original, 'new-chunk')]); return [[1, 0]]; };
    await new EmbedChunksJob(repo, { version: 'test', embed }, store).run(job);
    expect(store.upsert).not.toHaveBeenCalled();
    expect((await repo.listChunks('lab')).map(c => c.id)).toEqual(['new-chunk']);
  });

  it('completes the current revision and rejects older queued payloads or missing chunks', async () => {
    const { db, repo, search } = await setup();
    await repo.save(edited);
    const queue = new JobQueue(db);
    const embed = vi.fn(async () => [[1, 0]]);
    const onIndexed = vi.fn();
    const handler = new EmbedChunksJob(repo, { version: 'test', embed }, vectorStore(), { onIndexed });
    await handler.run(job);
    expect(onIndexed).not.toHaveBeenCalled();
    await new ChunkNoteJob(repo, queue).run({ ...job, type: 'chunk_note' });
    await handler.run({ ...job, payload: { contentRevision: 0 } });
    expect(embed).not.toHaveBeenCalled();
    const pending = await queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.contentRevision).toBe(1);
    await handler.run(pending[0]);
    expect(onIndexed).toHaveBeenCalledOnce();
    expect((await repo.findById('lab'))?.indexStatus).toBe('indexed');
    expect((await search('溶解度'))[0].text).toBe(edited.content);
    expect(await search('提取率')).toEqual([]);
    await repo.save({ ...edited, content: '', contentHash: 'empty' });
    await new ChunkNoteJob(repo, queue).run({ ...job, type: 'chunk_note' });
    expect(await repo.listChunks('lab')).toEqual([]);
    expect((await repo.findById('lab'))?.indexStatus).toBe('indexed');
  });

  it('preserves edits made while the original file is being parsed, including on retry', async () => {
    const { db, repo } = await setup();
    await repo.save({ ...original, sourceUri: 'C:/synthetic.pdf' });
    const parse = vi.fn(async () => {
      await repo.save({ ...edited, sourceUri: 'C:/synthetic.pdf' });
      return { title: 'Original file', content: original.content, sourceType: 'pdf' as const };
    });
    const handler = new ParseNoteJob(repo, { parse, hash: async () => 'parsed-hash' }, new JobQueue(db));
    await handler.run({ ...job, type: 'parse_note' });
    expect((await repo.findById('lab'))?.content).toBe(edited.content);
    await repo.updateIndexStatus('lab', 'failed');
    await handler.run({ ...job, type: 'parse_note' });
    expect(parse).toHaveBeenCalledOnce();
    expect((await repo.findById('lab'))?.content).toBe(edited.content);
  });

  it('filters Chroma results through current local chunks and preserves exact positions', async () => {
    const { db, repo } = await setup();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ids: [['old-chunk', 'ghost']],
      distances: [[0, 0]], documents: [['untrusted cached text', 'ghost']], metadatas: [[{ note_id: 'lab' }, { note_id: 'lab' }]], id: 'collection' })));
    const store = new ChromaProvider({ fetchImpl, resolveMatches: matches => currentVectorMatches(db, matches) });
    expect(await store.query([1, 0], 10)).toEqual([{ chunkId: 'old-chunk', noteId: 'lab', text: original.content, score: 1, charStart: 0 }]);
    await repo.save(edited);
    expect(await store.query([1, 0], 10)).toEqual([]);
  });
});
