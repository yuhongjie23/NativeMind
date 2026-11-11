import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { FileImportPort, Note, NoteRenameRepository, NoteRepository } from '@application/ports';
import { RenameNoteUseCase } from '@application/use-cases/note/rename-note';
import { SimpleEventBus } from '@application/events/event-bus';
import { registerNoteIndexSubscriber } from '@application/events/subscribers/note-index-subscriber';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { Database } from '@infrastructure/db/database';
import { InMemoryJobQueue, InMemoryNoteRepository } from '@infrastructure/local-demo';
import { NodeSqliteDriver } from './sqlite-driver';

const note = (id: string, title: string, content: string): Note => ({
  id, title, content, contentHash: createHash('sha256').update(content).digest('hex'), sourceType: 'manual', indexStatus: 'indexed', tags: [],
  createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z',
});
const original = note('source', 'Old title', 'Original material [[Old title|self]]');
const referring = note('ref', 'A referring note', 'Try [[ Old title | visible label ]] and [[Old title]]. `[[Old title]]` remains an example.');
const files: FileImportPort = { hash: async text => createHash('sha256').update(text).digest('hex'), parse: async () => { throw new Error('unused'); } };

describe.each(['sqlite', 'memory'] as const)('rename note atomically (%s)', mode => {
  let db: Database | undefined;
  let driver: NodeSqliteDriver;
  let jobs: InMemoryJobQueue;
  let notes: NoteRepository & NoteRenameRepository;
  let useCase: RenameNoteUseCase;
  let events: SimpleEventBus;
  const jobList = async () => db ? db.select('SELECT entity_id AS id FROM background_jobs') : (await jobs.listAll()).map(job => ({ id: job.entityId }));
  beforeEach(async () => {
    jobs = new InMemoryJobQueue();
    if (mode === 'sqlite') {
      driver = new NodeSqliteDriver(); db = new Database(driver); await db.migrate(); notes = new SqliteNoteRepository(db);
    } else notes = new InMemoryNoteRepository(jobs);
    events = new SimpleEventBus();
    useCase = new RenameNoteUseCase(notes, notes, files, events);
    await notes.save(original); await notes.save(referring);
  });
  afterEach(async () => { vi.restoreAllMocks(); await db?.close(); db = undefined; });

  it('previews without writes and atomically renames self/incoming links while retaining labels and code', async () => {
    const preview = await useCase.preview('source', 'New title');
    expect(preview.linkCount).toBe(3);
    expect((await notes.findById('source'))?.title).toBe('Old title');
    expect(await jobList()).toEqual([]);
    const duplicateEnqueue = vi.fn(async () => {});
    registerNoteIndexSubscriber(events, { enqueue: duplicateEnqueue });
    await useCase.execute(preview.ticket);
    expect((await notes.findById('source'))?.content).toBe('Original material [[New title|self]]');
    expect((await notes.findById('ref'))?.content).toBe('Try [[ New title | visible label ]] and [[New title]]. `[[Old title]]` remains an example.');
    expect((await notes.findById('ref'))?.contentHash).toBe(await files.hash((await notes.findById('ref'))!.content));
    expect((await notes.findById('ref'))?.indexStatus).toBe('stale');
    expect(await jobList()).toHaveLength(2); expect(duplicateEnqueue).not.toHaveBeenCalled();
    await expect(useCase.execute(preview.ticket)).rejects.toThrow('重新预览');
  });

  it('cancellation releases a preview without modifying any notes', async () => {
    const preview = await useCase.preview('source', 'New title'); useCase.discard(preview.ticket);
    await expect(useCase.execute(preview.ticket)).rejects.toThrow('重新预览');
    expect((await notes.findById('ref'))?.content).toBe(referring.content); expect(await jobList()).toEqual([]);
  });

  it('allows background indexing to finish during preview without reverting its status', async () => {
    await notes.save({ ...original, content: 'No self link', contentHash: 'no-link', indexStatus: 'indexing' });
    const preview = await useCase.preview('source', 'New title');
    const current = (await notes.findById('source'))!;
    await notes.save({ ...current, indexStatus: 'indexed' });
    await useCase.execute(preview.ticket);
    expect((await notes.findById('source'))?.indexStatus).toBe('indexed');
    expect((await notes.findById('source'))?.title).toBe('New title');
  });

  it.each(['source', 'ref'])('rejects an edited %s after preview, without overwriting it', async id => {
    const preview = await useCase.preview('source', 'New title');
    const before = (await notes.findById(id))!;
    await notes.save({ ...before, tags: ['edited during preview'] });
    await expect(useCase.execute(preview.ticket)).rejects.toThrow('重新预览');
    expect((await notes.findById(id))?.tags).toEqual(['edited during preview']);
    expect((await notes.findById('source'))?.title).toBe('Old title'); expect(await jobList()).toEqual([]);
  });

  it('rejects newly introduced incoming links after preview', async () => {
    const preview = await useCase.preview('source', 'New title');
    await notes.save(note('new-ref', 'New referring note', '[[Old title]]'));
    await expect(useCase.execute(preview.ticket)).rejects.toThrow('重新预览');
    expect((await notes.findById('source'))?.title).toBe('Old title'); expect(await jobList()).toEqual([]);
  });

  it('rejects deleted references and new title conflicts after preview', async () => {
    const first = await useCase.preview('source', 'New title'); await notes.delete('ref');
    await expect(useCase.execute(first.ticket)).rejects.toThrow('重新预览');
    const second = await useCase.preview('source', 'New title'); await notes.save(note('collision', 'New title', 'Other'));
    await expect(useCase.execute(second.ticket)).rejects.toThrow('已被其他笔记使用');
    expect((await notes.findById('source'))?.title).toBe('Old title');
  });

  it('renames only the selected note when its original title was ambiguous', async () => {
    await notes.save(note('duplicate', 'Old title', 'Other note'));
    const preview = await useCase.preview('source', 'Unique title');
    expect(preview.ambiguous).toBe(true); expect(preview.linkCount).toBe(0);
    await useCase.execute(preview.ticket);
    expect((await notes.findById('source'))?.title).toBe('Unique title');
    expect((await notes.findById('ref'))?.content).toBe(referring.content);
    expect((await notes.findById('duplicate'))?.title).toBe('Old title'); expect(await jobList()).toEqual([]);
  });

  it('preserves card provenance and topic quotations', async () => {
    const card = note('card', 'Card', 'Read [[Old title]]');
    card.cardSource = { noteId: original.id, title: original.title, contentHash: original.contentHash, quote: original.content, charStart: 0, charEnd: original.content.length };
    await notes.save(card);
    const topic = note('topic', 'Topic', 'Quoted: [[Old title]]');
    topic.topicPage = { title: 'Topic', selectionKey: 'one', sources: [{ noteId: original.id, title: original.title,
      contentHash: original.contentHash, excerpt: original.content, totalChars: original.content.length }], groups: [{ title: 'Group',
      members: [{ noteId: original.id, quote: original.content, reason: 'Saved reference' }] }] };
    await notes.save(topic);
    const preview = await useCase.preview('source', 'New title'); await useCase.execute(preview.ticket);
    expect((await notes.findById('card'))?.cardSource).toEqual(card.cardSource);
    expect((await notes.findById('topic'))?.topicPage).toEqual(topic.topicPage);
    expect((await notes.findById('topic'))?.content).toBe(topic.content);
  });

  it('adjusts imported page offsets after changing link length', async () => {
    const ref = note('ref', 'Pages', '[[Old title]]\nSecond page'); ref.pageRanges = [{ page: 1, start: 0, end: 14 }, { page: 2, start: 14, end: ref.content.length }];
    await notes.save(ref);
    const preview = await useCase.preview('source', 'Longer new title'); await useCase.execute(preview.ticket);
    const updated = (await notes.findById('ref'))!;
    expect(updated.content.slice(updated.pageRanges![1].start)).toBe('Second page');
    expect(updated.pageRanges![1].end).toBe(updated.content.length);
  });

  it('rolls back all writes if index job creation fails', async () => {
    const preview = await useCase.preview('source', 'New title');
    if (mode === 'sqlite') {
      const execute = driver.execute.bind(driver); let count = 0;
      vi.spyOn(driver, 'execute').mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO background_jobs') && ++count === 2) throw new Error('Job storage full');
        return execute(sql, params);
      });
    } else vi.spyOn(jobs, 'pushMany').mockImplementation(() => { throw new Error('Job storage full'); });
    await expect(useCase.execute(preview.ticket)).rejects.toThrow('Job storage full');
    expect((await notes.findById('source'))?.title).toBe('Old title');
    expect((await notes.findById('ref'))?.content).toBe(referring.content); expect(await jobList()).toEqual([]);
  });

  it('rejects invalid titles and collisions before preview', async () => {
    for (const title of ['', '  ', 'x'.repeat(121), 'Bad|title', 'Bad#heading', 'Line\nbreak', 'Old title']) {
      await expect(useCase.preview('source', title)).rejects.toThrow();
    }
    await expect(useCase.preview('source', referring.title)).rejects.toThrow('已被其他笔记使用');
    expect(await jobList()).toEqual([]);
  });

  it('undo restores exact text, labels and page ranges even after indexing finishes', async () => {
    await notes.save({ ...referring, pageRanges: [{ page: 1, start: 0, end: referring.content.length }] });
    const preview = await useCase.preview('source', 'A longer new title');
    await useCase.execute(preview.ticket);
    expect(useCase.undoAvailable('source')).toEqual({ oldTitle: 'Old title', newTitle: 'A longer new title' });
    for (const id of ['source', 'ref']) await notes.save({ ...(await notes.findById(id))!, indexStatus: 'indexed' });
    await useCase.undo('source');
    expect((await notes.findById('source'))?.title).toBe(original.title);
    expect((await notes.findById('ref'))?.content).toBe(referring.content);
    expect((await notes.findById('ref'))?.contentHash).toBe(referring.contentHash);
    expect((await notes.findById('ref'))?.pageRanges).toEqual([{ page: 1, start: 0, end: referring.content.length }]);
    expect(await jobList()).toHaveLength(4); expect(useCase.undoAvailable('source')).toBeUndefined();
    await expect(useCase.undo('source')).rejects.toThrow('没有可撤销');
  });

  it('undo refuses to overwrite a later edit or delete', async () => {
    const preview = await useCase.preview('source', 'New title'); await useCase.execute(preview.ticket);
    await notes.save({ ...(await notes.findById('ref'))!, tags: ['new work'] });
    await expect(useCase.undo('source')).rejects.toThrow('无法安全撤销');
    expect((await notes.findById('ref'))?.tags).toEqual(['new work']);
    expect((await notes.findById('source'))?.title).toBe('New title');
    await notes.delete('ref');
    await expect(useCase.undo('source')).rejects.toThrow('无法安全撤销');
    expect(await jobList()).toHaveLength(2);
  });

  it('undo blocks added references and title conflicts', async () => {
    const preview = await useCase.preview('source', 'New title'); await useCase.execute(preview.ticket);
    await notes.save(note('extra', 'Extra', '[[New title]]'));
    await expect(useCase.undo('source')).rejects.toThrow('无法安全撤销');
    await notes.delete('extra'); await notes.save(note('collision', 'Old title', 'New note'));
    await expect(useCase.undo('source')).rejects.toThrow('原标题已被占用');
    expect((await notes.findById('source'))?.title).toBe('New title');
  });

  it('undo does not rewrite unrelated references which already used the new title', async () => {
    await notes.save(note('future', 'Unresolved link', '[[New title]]'));
    const preview = await useCase.preview('source', 'New title'); await useCase.execute(preview.ticket);
    await expect(useCase.undo('source')).rejects.toThrow('无法安全撤销');
    expect((await notes.findById('future'))?.content).toBe('[[New title]]');
  });

  it('undo rolls back on queue failure and can retry without losing its receipt', async () => {
    const preview = await useCase.preview('source', 'New title'); await useCase.execute(preview.ticket);
    if (mode === 'sqlite') {
      const execute = driver.execute.bind(driver);
      vi.spyOn(driver, 'execute').mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO background_jobs')) throw new Error('Disk full');
        return execute(sql, params);
      });
    } else vi.spyOn(jobs, 'pushMany').mockImplementation(() => { throw new Error('Disk full'); });
    await expect(useCase.undo('source')).rejects.toThrow('Disk full');
    expect((await notes.findById('source'))?.title).toBe('New title');
    expect(await jobList()).toHaveLength(2); expect(useCase.undoAvailable('source')).toBeDefined();
    vi.restoreAllMocks(); await useCase.undo('source');
    expect((await notes.findById('source'))?.title).toBe('Old title');
  });

  it('only retains the most recent successful rename in this runtime', async () => {
    const preview = await useCase.preview('source', 'New title'); await useCase.execute(preview.ticket);
    const other = await useCase.preview('ref', 'Ref renamed'); await useCase.execute(other.ticket);
    expect(useCase.undoAvailable('source')).toBeUndefined(); expect(useCase.undoAvailable('ref')).toBeDefined();
    const restarted = new RenameNoteUseCase(notes, notes, files, events);
    expect(restarted.undoAvailable('ref')).toBeUndefined();
    await expect(restarted.undo('ref')).rejects.toThrow('没有可撤销');
  });

  it('serializes rename/undo commits and prevents a double click from applying twice', async () => {
    const preview = await useCase.preview('source', 'New title');
    const commit = notes.commitRename.bind(notes);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(notes, 'commitRename').mockImplementation(async plan => { await wait; await commit(plan); });
    const pending = useCase.execute(preview.ticket);
    await expect(useCase.execute(preview.ticket)).rejects.toThrow('正在保存');
    await expect(useCase.undo('source')).rejects.toThrow('正在保存');
    release(); await pending; expect(await jobList()).toHaveLength(2);
  });
});
