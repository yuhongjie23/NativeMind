import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Note, NoteRepository } from '@application/ports';
import { QueryNoteReferencesUseCase } from '@application/use-cases/note/query-note-references';
import { ResolveWikiLinkUseCase } from '@application/use-cases/note/resolve-wiki-link';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { InMemoryNoteRepository } from '@infrastructure/local-demo';
import { NodeSqliteDriver } from './sqlite-driver';

const note = (id: string, title: string, content = 'Ordinary content'): Note => ({
  id, title, content, contentHash: id, sourceType: 'manual', indexStatus: 'indexed', tags: [],
  createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z',
});

describe.each(['sqlite', 'memory'] as const)('wiki links (%s)', driver => {
  let db: Database | undefined;
  let repo: NoteRepository;
  let resolve: ResolveWikiLinkUseCase;
  let references: QueryNoteReferencesUseCase;
  beforeEach(async () => {
    if (driver === 'sqlite') {
      db = new Database(new NodeSqliteDriver()); await db.migrate(); repo = new SqliteNoteRepository(db);
    } else repo = new InMemoryNoteRepository();
    resolve = new ResolveWikiLinkUseCase(repo); references = new QueryNoteReferencesUseCase(repo);
    await repo.save(note('target', '二分查找'));
  });
  afterEach(async () => { await db?.close(); db = undefined; });

  it('resolves an existing title and shows one backlink with the exact inline anchor', async () => {
    const body = '😀 Consider [[二分查找|边界]] and [[二分查找]].';
    await repo.save(note('ref', 'Boundary questions', body));
    expect(await resolve.execute(' 二分查找 ')).toMatchObject({ status: 'found', note: { id: 'target' } });
    const page = await references.execute('target');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ kind: 'link', stale: false, charStart: body.indexOf('[['), anchor: '[[二分查找|边界]]' });
    expect(page.items[0].quotes[0].quote).toBe(body);
  });

  it('never picks an arbitrary duplicate title or counts ambiguous backlinks', async () => {
    await repo.save(note('ref', 'Ref', '[[二分查找]]'));
    await repo.save(note('duplicate', '二分查找'));
    expect(await resolve.execute('二分查找')).toEqual({ status: 'ambiguous' });
    expect((await references.execute('target')).items).toEqual([]);
    await repo.delete('duplicate');
    expect((await references.execute('target')).items).toHaveLength(1);
  });

  it('does not create missing notes and matches titles case-sensitively', async () => {
    expect(await resolve.execute('Missing')).toEqual({ status: 'missing' });
    expect(await repo.findByTitle('Missing')).toEqual([]);
    await repo.save(note('case', 'Search'));
    expect(await resolve.execute('search')).toEqual({ status: 'missing' });
    expect(await resolve.execute('Search')).toMatchObject({ status: 'found' });
    expect(await resolve.execute("' OR 1=1 --")).toEqual({ status: 'missing' });
  });

  it('responds to edits, renames and deletions without rewriting other notes', async () => {
    const ref = note('ref', 'Ref', '[[二分查找]]'); await repo.save(ref);
    await repo.save(note('target', 'Binary search'));
    expect(await resolve.execute('二分查找')).toEqual({ status: 'missing' });
    expect((await references.execute('target')).items).toEqual([]);
    expect(await repo.findById('ref')).toEqual(ref);
    await repo.save({ ...ref, content: '[[Binary search]]' });
    expect((await references.execute('target')).items).toHaveLength(1);
    await repo.delete('target');
    expect(await resolve.execute('Binary search')).toEqual({ status: 'missing' });
  });

  it('filters code before pagination and finds references beyond 100 unrelated notes', async () => {
    for (let i = 0; i < 110; i++) await repo.save(note(`a-${i}`, `Example ${i}`, '`[[二分查找]]`'));
    for (let i = 0; i < 25; i++) await repo.save(note(`z-${String(i).padStart(2, '0')}`, `Link ${i}`, '[[二分查找]]'));
    const first = await references.execute('target'); const next = await references.execute('target', 20);
    expect(first.items).toHaveLength(20); expect(first.hasMore).toBe(true);
    expect(next.items).toHaveLength(5); expect(next.hasMore).toBe(false);
    expect(new Set([...first.items, ...next.items].map(item => item.noteId)).size).toBe(25);
  });

  it('does not double-count notes with both card provenance and inline links', async () => {
    const card = note('card', 'Card', '[[二分查找]]');
    card.cardSource = { noteId: 'target', title: '二分查找', contentHash: 'target', quote: 'Ordinary content', charStart: 0, charEnd: 16 };
    await repo.save(card);
    const page = await references.execute('target');
    expect(page.items).toHaveLength(1); expect(page.items[0].kind).toBe('card');
  });
});
