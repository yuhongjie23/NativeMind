import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NoteCandidateProvider } from '@infrastructure/rag/note-candidate-provider';
import { NodeSqliteDriver } from './sqlite-driver';
import type { Note } from '@application/ports';
import { InMemoryNoteRepository, LocalNoteSearchPort } from '@infrastructure/local-demo';

const drivers: NodeSqliteDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map(driver => driver.close())); });
const setup = async () => {
  const driver = new NodeSqliteDriver(':memory:');
  drivers.push(driver);
  const db = new Database(driver);
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  return { repo, driver, provider: new NoteCandidateProvider(repo) };
};
const note = (id: string, indexStatus: Note['indexStatus'] = 'pending'): Note => ({
  id, title: 'Tea extraction', content: 'A saved note about solvents.', contentHash: id,
  sourceType: 'imported_text', indexStatus, tags: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z',
});

describe('saved note title lookup', () => {
  it('recalls two-character Chinese terms in a question before capping candidates', async () => {
    const { repo, provider } = await setup();
    await repo.save({ ...note('book', 'indexed'), title: '学习材料' });
    const texts = [
      ...Array.from({ length: 30 }, () => '为什么孩子在成长中会发生变化？'),
      '母亲热爱孩子，并不是因为孩子满足了她的愿望。通过努力换取的爱往往会使人生疑。',
    ];
    await repo.replaceChunks('book', texts.map((text, i) => ({ id: `p-${i}`, noteId: 'book', text,
      headingPath: [], charStart: i * 100, charEnd: i * 100 + text.length, tags: [], createdAt: '2026-11-10T02:00:00Z' })));
    const hits = await provider.listCandidates({ text: '为什么孩子不需要用表现来换取母亲的爱？' }, 10);
    expect(hits.map(h => h.chunkId)).toContain('p-30');
  });
  it.each(['pending', 'failed'] as const)('finds a newly imported %s note without any chunks', async status => {
    const { repo, provider } = await setup();
    await repo.save(note('tea', status));
    const hits = await provider.listCandidates({ text: ' TEA EXTRACTION ', preferLiteralMatches: true }, 10);
    expect(hits).toEqual([expect.objectContaining({ noteId: 'tea', text: note('tea').content, charStart: 0 })]);
    expect(await repo.listChunksForNotes(['tea'])).toEqual([]);
    expect((await repo.findById('tea'))?.indexStatus).toBe(status);
  });

  it('prioritizes a short matching title over a long competing book and preserves offsets', async () => {
    const { repo, provider } = await setup();
    await repo.save({ ...note('book', 'indexed'), title: 'Tea extraction handbook' });
    await repo.save(note('tea', 'indexed'));
    const chunk = (id: string, noteId: string, charStart = 0) => ({ id, noteId,
      text: 'Tea extraction', headingPath: [], charStart, charEnd: charStart + 14,
      tags: [], createdAt: '2026-11-10T02:00:00Z' });
    await repo.replaceChunks('book', Array.from({ length: 110 }, (_, i) => chunk(`book-${i}`, 'book')));
    await repo.replaceChunks('tea', [chunk('tea-1', 'tea', 120)]);
    expect(await provider.listCandidates({ text: 'Tea extraction', preferLiteralMatches: true }, 10))
      .toEqual([expect.objectContaining({ chunkId: 'tea-1', noteId: 'tea', charStart: 120 })]);
  });

  it('preserves duplicate titles and excludes the requested note', async () => {
    const { repo, provider } = await setup();
    await repo.save(note('tea'));
    await repo.save(note('tea-2'));
    const query = { text: 'Tea extraction', preferLiteralMatches: true };
    expect(await provider.listCandidates(query, 10)).toHaveLength(2);
    expect((await provider.listCandidates({ ...query, excludeNoteIds: ['tea'] }, 10)).map(hit => hit.noteId)).toEqual(['tea-2']);
  });

  it('finds an older exact title beyond 500 newer partial matches', async () => {
    const { repo, provider } = await setup();
    await repo.save({ ...note('z-target'), updatedAt: '2020-01-01T00:00:00Z' });
    for (let i = 0; i < 505; i++) await repo.save({ ...note(`a-${i}`), title: `Tea extraction handbook ${i}` });
    expect((await provider.listCandidates({ text: 'tea extraction', preferLiteralMatches: true }, 5)).map(c => c.noteId))
      .toEqual(['z-target']);
  });

  it('returns one preview per matching note, preserving different notes with the same title', async () => {
    const { repo, provider } = await setup();
    for (const id of ['tea', 'tea-2']) {
      await repo.save(note(id, 'indexed'));
      await repo.replaceChunks(id, Array.from({ length: 8 }, (_, i) => ({ id: `${id}-${i}`, noteId: id,
        text: `Passage ${i}`, headingPath: [], charStart: i * 20, charEnd: i * 20 + 9,
        tags: [], createdAt: '2026-11-10T02:00:00Z' })));
    }
    expect((await provider.listCandidates({ text: 'Tea extraction', preferLiteralMatches: true }, 10)).map(c => c.noteId).sort())
      .toEqual(['tea', 'tea-2']);
  });

  it('uses the same Unicode case and surrounding-whitespace rules as retrieval', async () => {
    const { repo, provider } = await setup();
    await repo.save({ ...note('unicode'), title: '\tÉTUDE\u3000' });
    expect((await provider.listCandidates({ text: 'étude', preferLiteralMatches: true }, 10)).map(c => c.noteId)).toEqual(['unicode']);
  });

  it('pages metadata only, excludes before the cap, and loads bodies only for exact matches', async () => {
    const { repo, driver } = await setup();
    for (let i = 0; i < 270; i++) await repo.save({ ...note(`a-${i}`), content: 'Long body '.repeat(100) });
    await repo.save(note('z-target'));
    const select = vi.spyOn(driver, 'select');
    const excluded = Array.from({ length: 270 }, (_, i) => `a-${i}`);
    expect((await repo.findBySearchTitle('Tea extraction', excluded, 1)).map(n => n.id)).toEqual(['z-target']);
    const bodyReads = select.mock.calls.filter(([sql]) => sql.includes('content_hash'));
    expect(bodyReads).toHaveLength(1);
    expect(bodyReads[0][1]).toEqual(['z-target']);
    expect(select.mock.calls.filter(([sql]) => sql.includes('SELECT id, title, updated_at'))).toHaveLength(2);
  });

  it('stops a cancelled catalog scan before another page or body lookup', async () => {
    const { repo, driver } = await setup();
    for (let i = 0; i < 260; i++) await repo.save({ ...note(`a-${i}`), title: 'Unrelated' });
    const controller = new AbortController();
    const original = driver.select.bind(driver);
    const select = vi.spyOn(driver, 'select').mockImplementation(async (sql, params) => {
      const rows = await original(sql, params);
      controller.abort();
      return rows;
    });
    await expect(repo.findBySearchTitle('Tea extraction', [], 5, controller.signal)).rejects.toThrow();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('does not return a note renamed during catalog lookup or change wiki-link title resolution', async () => {
    const { repo } = await setup();
    await repo.save(note('tea'));
    expect(await repo.findByTitle('tea extraction')).toEqual([]);
    expect(await repo.findByTitle('Tea extraction')).toHaveLength(1);
    vi.spyOn(repo, 'findByIds').mockResolvedValue([{ ...note('tea'), title: 'Renamed' }]);
    expect(await repo.findBySearchTitle('Tea extraction', [], 5)).toEqual([]);
  });

  it('keeps exact-title previews distinct in the browser demo and leaves deep search unchanged', async () => {
    const repo = new InMemoryNoteRepository();
    await repo.save({ ...note('handbook'), title: 'Tea extraction handbook' });
    await repo.save(note('tea'));
    await repo.save(note('tea-2'));
    const search = new LocalNoteSearchPort(repo);
    const hits = await search.search(' TEA EXTRACTION ', 10);
    expect(hits.map(hit => hit.noteId).sort()).toEqual(['tea', 'tea-2']);
    expect(hits.every(hit => hit.exactTitleMatch)).toBe(true);
    expect((await search.search('Tea extraction', 10, true)).some(hit => hit.noteId === 'handbook')).toBe(true);
    expect(await search.search('Tea extraction', 0)).toEqual([]);
  });

  it('respects cancellation during browser exact-title publication', async () => {
    const repo = new InMemoryNoteRepository();
    await repo.save(note('tea'));
    const controller = new AbortController();
    await expect(new LocalNoteSearchPort(repo).search('Tea extraction', 10, false, {
      signal: controller.signal, onPartial: () => controller.abort(),
    })).rejects.toThrow();
  });
});
