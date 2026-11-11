import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Note, NoteRepository } from '@application/ports';
import { QueryNoteReferencesUseCase } from '@application/use-cases/note/query-note-references';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { InMemoryNoteRepository } from '@infrastructure/local-demo';
import { NodeSqliteDriver } from './sqlite-driver';

const original: Note = {
  id: 'source', title: 'Binary search', content: 'Binary search needs sorted input.', contentHash: 'revision-1',
  sourceType: 'manual', indexStatus: 'indexed', tags: [], createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z',
};
const card = (id: string): Note => ({
  ...original, id, title: `Card ${id}`, content: 'A learning card', contentHash: `card-${id}`,
  cardSource: { noteId: original.id, title: original.title, contentHash: original.contentHash,
    quote: original.content, charStart: 0, charEnd: original.content.length },
});
const topic = (): Note => ({
  ...original, id: 'topic', title: 'Search topic', content: 'Grouped search notes', contentHash: 'topic-hash',
  topicPage: { title: 'Search topic', selectionKey: 'selection',
    sources: [{ noteId: original.id, title: original.title, contentHash: original.contentHash, excerpt: original.content, totalChars: original.content.length }],
    groups: ['Preconditions', 'Algorithms'].map(title => ({ title, members: [
      { noteId: original.id, quote: original.content, reason: 'Explains the sorted-input condition.' },
    ] })),
  },
});

describe.each(['sqlite', 'memory'] as const)('saved note references (%s)', driver => {
  let db: Database | undefined;
  let notes: NoteRepository;
  let query: QueryNoteReferencesUseCase;
  beforeEach(async () => {
    if (driver === 'sqlite') {
      db = new Database(new NodeSqliteDriver()); await db.migrate(); notes = new SqliteNoteRepository(db);
    } else notes = new InMemoryNoteRepository();
    query = new QueryNoteReferencesUseCase(notes);
    await notes.save(original);
  });
  afterEach(async () => { await db?.close(); db = undefined; });

  it('projects saved source and inline references for the graph, without duplicate pairs or dangling targets', async () => {
    await notes.save(card('card')); await notes.save(topic());
    await notes.save({ ...original, id: 'inline', title: 'Linked note', content: 'See [[Binary search]] twice [[Binary search]]. `[[Search topic]]` is code.' });
    const edges = await notes.listGraphReferences(['source', 'card', 'topic', 'inline'], 100);
    expect(edges).toEqual(expect.arrayContaining([
      { fromId: 'card', toId: 'source', kind: 'card' }, { fromId: 'topic', toId: 'source', kind: 'topic' },
      { fromId: 'inline', toId: 'source', kind: 'link' },
    ]));
    expect(edges).toHaveLength(3);
    expect(await notes.listGraphReferences(['card'], 100)).toEqual([]);
    expect(await notes.listGraphReferences(['source', 'card', 'topic', 'inline'], 1)).toHaveLength(1);
    await notes.save({ ...original, id: 'duplicate' }); // outside the displayed subset
    expect(await notes.listGraphReferences(['source', 'inline'], 100)).toEqual([]);
  });

  it('shows outgoing source evidence and safe anchors, marking changed source quotations stale', async () => {
    await notes.save(card('card'));
    const page = await query.connections('card', 'outgoing');
    expect(page.items[0]).toMatchObject({ noteId: 'source', charStart: 0, anchor: original.content, stale: false });
    await notes.save({ ...original, content: 'Changed content', contentHash: 'changed' });
    const changed = await query.connections('card', 'outgoing');
    expect(changed.items[0]).toMatchObject({ stale: true });
    expect(changed.items[0].anchor).toBeUndefined();
    expect(changed.items[0].quotes[0].quote).toBe(original.content);
  });

  it('does not resolve ambiguous outgoing wiki links or self links', async () => {
    await notes.save({ ...original, id: 'duplicate' });
    await notes.save({ ...original, id: 'inline', title: 'Inline', content: '[[Binary search]] [[Inline]]' });
    expect((await query.connections('inline', 'outgoing')).items).toEqual([]);
    await expect(query.connections('inline', 'outgoing', -1)).rejects.toThrow();
  });

  it('returns each referring page once, preserving all group quotations and current titles', async () => {
    await notes.save(card('card')); const page = topic(); await notes.save(page);
    await notes.save({ ...page, title: 'My renamed page' });
    const result = await query.execute(original.id);
    expect(result.items.map(item => [item.kind, item.title])).toEqual([
      ['card', 'Card card'], ['topic', 'My renamed page'],
    ]);
    expect(result.items[1].quotes.map(item => item.group)).toEqual(['Preconditions', 'Algorithms']);
    expect(result.items.every(item => !item.stale)).toBe(true);
    expect(await notes.findById(original.id)).toEqual(original);
  });

  it('does not infer references from ordinary text, unused selected sources, or self references', async () => {
    await notes.save({ ...original, id: 'plain', content: '[[Binary search]] source' });
    const unused = topic(); unused.topicPage!.groups = []; await notes.save(unused);
    await notes.save({ ...original, cardSource: card('any').cardSource });
    expect((await query.execute(original.id)).items).toEqual([]);
  });

  it('reads references beyond the first 100 notes and paginates without duplicate rows', async () => {
    for (let i = 0; i < 105; i++) await notes.save({ ...original, id: `unrelated-${i}` });
    for (let i = 0; i < 25; i++) {
      const saved = card(`ref-${String(i).padStart(2, '0')}`);
      // Historical source revisions can retain separate cards for the same span.
      saved.cardSource!.contentHash = `historical-revision-${i}`;
      await notes.save(saved);
    }
    const first = await query.execute(original.id); const second = await query.execute(original.id, 20);
    expect(first.items).toHaveLength(20); expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(5); expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(item => item.noteId)).size).toBe(25);
  });

  it('marks references stale after the source changes and retains the exact saved quote', async () => {
    await notes.save(card('card')); await notes.save(topic());
    await notes.save({ ...original, content: 'Changed source text.', contentHash: 'revision-2' });
    const result = await query.execute(original.id);
    expect(result.items.every(item => item.stale)).toBe(true);
    expect(result.items[0].quotes[0].quote).toBe(original.content);
  });

  it('keeps historical references when the source is deleted', async () => {
    await notes.save(card('card')); await notes.save(topic()); await notes.delete(original.id);
    const result = await query.execute(original.id);
    expect(result.sourceMissing).toBe(true); expect(result.items).toHaveLength(2);
    expect(result.items.every(item => item.stale)).toBe(true);
  });

  it('removes deleted referring pages from results without changing the source', async () => {
    await notes.save(card('card')); await notes.delete('card');
    expect((await query.execute(original.id)).items).toEqual([]);
    expect(await notes.findById(original.id)).toEqual(original);
  });

  it('treats source identifiers literally', async () => {
    await notes.save(card('card'));
    expect((await query.execute("' OR 1=1 --")).items).toEqual([]);
  });

  it('rejects invalid pagination', async () => {
    for (const offset of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(query.execute(original.id, offset)).rejects.toThrow('Invalid reference offset');
    }
  });
});
