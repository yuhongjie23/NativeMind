import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NoteCandidateProvider } from '@infrastructure/rag/note-candidate-provider';
import { NodeSqliteDriver } from './sqlite-driver';
import type { Note } from '@application/ports';

const drivers: NodeSqliteDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map(driver => driver.close())); });
const setup = async () => {
  const driver = new NodeSqliteDriver(':memory:');
  drivers.push(driver);
  const db = new Database(driver);
  await db.migrate();
  const repo = new SqliteNoteRepository(db);
  return { repo, provider: new NoteCandidateProvider(repo) };
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
});
