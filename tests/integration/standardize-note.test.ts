import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { FileImportPort, Note, StandardNoteDraft } from '@application/ports';
import { StandardizeNoteUseCase } from '@application/use-cases/note/standardize-note';
import { ImportNoteUseCase } from '@application/use-cases/note/import-note';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { NodeSqliteDriver } from './sqlite-driver';

const content = 'Binary search requires a sorted array. The interval shrinks at each step; duplicate values require a defined boundary rule.';
const source: Note = { id: 'source', title: 'Binary search notes', content, contentHash: 'source-version', sourceType: 'manual',
  indexStatus: 'indexed', tags: ['algorithms'], createdAt: '2026-11-10', updatedAt: '2026-11-10' };
const valid: StandardNoteDraft = { status: 'ready', title: 'Binary search', blocks: [
  { kind: 'overview', text: 'Binary search operates on sorted arrays.', quote: 'Binary search requires a sorted array.' },
  { kind: 'conditions', text: 'Define a boundary rule when values repeat.', quote: 'duplicate values require a defined boundary rule.' },
] };
const files: FileImportPort = { hash: async text => createHash('sha256').update(text).digest('hex'), parse: async input => {
  if (input.kind !== 'text') throw new Error('Unexpected file');
  return { title: input.title ?? '', content: input.content, sourceType: 'text' };
} };

describe('standard note confirmation and copy persistence', () => {
  let db: Database;
  let notes: SqliteNoteRepository;
  beforeEach(async () => {
    db = new Database(new NodeSqliteDriver()); await db.migrate(); notes = new SqliteNoteRepository(db); await notes.save(source);
  });
  afterEach(async () => db.close());
  const build = (draft = vi.fn(async (): Promise<StandardNoteDraft> => valid), prompt = vi.fn(async () => true), access = vi.fn(async () => {})) =>
    new StandardizeNoteUseCase(notes, { draft, requireAccess: access },
      new ConfirmationService(new SqliteActionProposalRepository(db), prompt), new ImportNoteUseCase(notes, files, new SimpleEventBus()));

  it('saves a separate standard note only after approval and deduplicates repeated saves', async () => {
    const prompt = vi.fn(async () => {
      expect(await db.select('SELECT id FROM notes')).toHaveLength(1);
      expect((await db.selectOne('SELECT action_type FROM action_proposals'))?.action_type).toBe('standardize_note');
      return true;
    });
    const saved = await build(undefined, prompt).execute(source.id, 'en');
    expect(saved?.id).not.toBe(source.id);
    expect(saved?.title).toBe('Binary search (organized)');
    expect(saved?.content).toContain('## Overview');
    expect(saved?.content).toContain('## Conditions and limitations');
    expect(saved?.content).not.toContain('## Examples');
    expect(saved?.content).toContain('[[Binary search notes]]');
    expect(saved?.indexStatus).toBe('pending');
    expect((await notes.findById(source.id))?.content).toBe(content);
    expect((await db.selectOne('SELECT status FROM action_proposals'))?.status).toBe('confirmed');
    expect((await build().execute(source.id, 'en'))?.id).toBe(saved?.id);
    expect(await db.select('SELECT id FROM notes')).toHaveLength(2);
    expect(await notes.listGraphReferences([source.id, saved!.id], 10)).toContainEqual({ fromId: saved!.id, toId: source.id, kind: 'link' });
  });

  it('does not write on rejection or insufficient content', async () => {
    expect(await build(undefined, vi.fn(async () => false)).execute(source.id, 'zh')).toBeUndefined();
    expect(await build(vi.fn(async () => ({ status: 'insufficient' as const, title: '', blocks: [] }))).execute(source.id, 'zh')).toBeUndefined();
    expect(await db.select('SELECT id FROM notes')).toHaveLength(1);
  });

  it.each(['fabricated evidence', 'wiki links', 'missing overview'] as const)('rejects %s before proposing', async failure => {
    const draft = structuredClone(valid);
    if (failure === 'fabricated evidence') draft.blocks[0].quote = 'This passage does not exist in the note.';
    if (failure === 'wiki links') draft.blocks[0].text = 'See [[Unknown new link]].';
    if (failure === 'missing overview') draft.blocks[0].kind = 'concepts';
    await expect(build(vi.fn(async () => draft)).execute(source.id, 'en')).rejects.toThrow();
    expect(await db.select('SELECT id FROM action_proposals')).toHaveLength(0);
    expect(await db.select('SELECT id FROM notes')).toHaveLength(1);
  });

  it('rejects oversized notes instead of silently sending only the beginning', async () => {
    await notes.save({ ...source, content: content + 'x'.repeat(12000) });
    const draft = vi.fn(async () => valid);
    await expect(build(draft).execute(source.id, 'en')).rejects.toThrow('不会截断');
    expect(draft).not.toHaveBeenCalled();
  });

  it('blocks cancellation and revoked consent before saving', async () => {
    const controller = new AbortController();
    await expect(build(vi.fn(async () => { controller.abort(); return valid; })).execute(source.id, 'en', { signal: controller.signal })).rejects.toThrow();
    let allowed = true;
    const access = vi.fn(async () => { if (!allowed) throw new Error('disabled'); });
    await expect(build(undefined, vi.fn(async () => { allowed = false; return true; }), access).execute(source.id, 'en')).rejects.toThrow('disabled');
    expect(await db.select('SELECT id FROM notes')).toHaveLength(1);
  });

  it('rejects stale drafts if the original changes while awaiting confirmation', async () => {
    await expect(build(undefined, vi.fn(async () => { await notes.save({ ...source, content: 'Edited by user' }); return true; }))
      .execute(source.id, 'en')).rejects.toThrow('已修改');
    expect(await db.select('SELECT id FROM notes')).toHaveLength(1);
  });
});
