import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileImportPort, Note } from '@application/ports';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { OrganizeNoteUseCase } from '@application/use-cases/note/organize-note';
import { ComposeTopicUseCase } from '@application/use-cases/note/compose-topic';
import { RenameNoteUseCase } from '@application/use-cases/note/rename-note';
import { Database } from '@infrastructure/db/database';
import { MIGRATIONS } from '@infrastructure/db/migrations';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { NodeSqliteDriver } from './sqlite-driver';

const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
const files: FileImportPort = { hash, parse: async () => { throw new Error('unused'); } };
const quotes = ['Binary search requires sorted input before discarding half the candidates.',
  'Lower bound searches sorted input for the first value at least as large as the target.'];

describe('knowledge upgrade from v2.0.0 on a disk-backed database', () => {
  let folder: string;
  let path: string;
  let db: Database;
  let notes: SqliteNoteRepository;
  let originals: Note[];
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'nativemind-knowledge-upgrade-'));
    path = join(folder, 'nativemind.db');
    db = new Database(new NodeSqliteDriver(path), MIGRATIONS.filter(item => item.version <= 25));
    await db.migrate();
    notes = new SqliteNoteRepository(db);
    originals = await Promise.all(quotes.map(async (content, i): Promise<Note> => ({
      id: `source-${i}`, title: `Source ${i}`, content, contentHash: await hash(content),
      sourceType: 'manual', indexStatus: 'indexed', tags: ['existing'],
      createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z',
      pageRanges: [{ page: 1, start: 0, end: content.length }],
    })));
    for (const note of originals) await notes.save(note);
    for (const status of ['pending', 'confirmed', 'rejected', 'expired']) {
      await db.execute(`INSERT INTO action_proposals
        (id, action_type, summary, payload, source, status, requires_confirmation, created_at, decided_at)
        VALUES (?, 'generate_review', 'Existing review', ?, 'ai', ?, 1, ?, ?)`,
      [`legacy-${status}`, JSON.stringify({ text: 'Existing local review draft', nested: { retained: true } }), status,
        '2026-11-09T00:00:00Z', status === 'pending' ? null : '2026-11-09T01:00:00Z']);
    }
  });
  afterEach(async () => { await db.close(); await rm(folder, { recursive: true, force: true }); });

  async function reopen() {
    await db.close();
    db = new Database(new NodeSqliteDriver(path));
    notes = new SqliteNoteRepository(db);
    return db.migrate();
  }

  it('upgrades existing records without changing them, and does not rerun migrations on restart', async () => {
    const before = await db.select('SELECT * FROM notes ORDER BY id');
    const proposalsBefore = await db.select('SELECT * FROM action_proposals ORDER BY id');
    expect((await reopen()).map(item => item.version)).toEqual([26, 27, 28, 29, 30, 31, 32]);
    expect(await db.select('SELECT * FROM notes ORDER BY id')).toEqual(before.map(row => ({ ...row, content_revision: 0 })));
    expect(await db.select('SELECT * FROM action_proposals ORDER BY id')).toEqual(proposalsBefore);
    expect(await notes.findByIds(originals.map(note => note.id))).toEqual(originals);
    expect(await reopen()).toEqual([]);
    expect(await db.select('SELECT * FROM notes ORDER BY id')).toEqual(before.map(row => ({ ...row, content_revision: 0 })));
    expect(await db.select('SELECT * FROM action_proposals ORDER BY id')).toEqual(proposalsBefore);
    expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('keeps confirmed cards, progress, topics, renamed links and index jobs after closing the connection', async () => {
    await reopen();
    const confirmation = new ConfirmationService(new SqliteActionProposalRepository(db), async () => true);
    const events = new SimpleEventBus();
    const organize = new OrganizeNoteUseCase(notes, notes, {
      requireAccess: async () => {}, draft: async () => [{ title: 'Sorted input', body: 'Check the precondition.', quote: quotes[0] }],
    }, files, confirmation, events);
    const [card] = await organize.execute('source-0', 'en');
    const progress = await organize.progress('source-0');
    const compose = new ComposeTopicUseCase(notes, notes, {
      requireAccess: async () => {}, draft: async () => ({ title: 'Sorted searches', groups: [{
        title: 'Shared precondition', members: quotes.map((quote, i) => ({ noteId: `source-${i}`, quote, reason: 'Requires sorted input.' })),
      }] }),
    }, files, confirmation, events);
    const page = await compose.execute(['source-0', 'source-1'], 'en');
    const content = 'Review [[Source 0|the precondition]] before [[Source 0]].';
    await notes.save({ ...originals[1], id: 'referrer', title: 'Practice', content, contentHash: await hash(content), pageRanges: undefined });
    const rename = new RenameNoteUseCase(notes, notes, files, events);
    await rename.execute((await rename.preview('source-0', 'Sorted input source')).ticket);
    const jobs = await db.select('SELECT * FROM background_jobs ORDER BY id');
    expect(jobs).toHaveLength(3);
    await reopen();
    expect(await notes.findById(card.id)).toEqual(card);
    expect(await notes.findById(page!.id)).toEqual(page);
    const resumed = new OrganizeNoteUseCase(notes, notes, undefined, files, confirmation, events);
    expect(await resumed.progress('source-0')).toEqual(progress);
    expect((await notes.findById('source-0'))?.title).toBe('Sorted input source');
    expect((await notes.findById('referrer'))?.content).toBe('Review [[Sorted input source|the precondition]] before [[Sorted input source]].');
    expect((await notes.findReferencingNotes('source-0', 20, 0)).map(note => note.id).sort()).toEqual([card.id, page!.id, 'referrer'].sort());
    expect(await db.select('SELECT * FROM background_jobs ORDER BY id')).toEqual(jobs);
    expect(new RenameNoteUseCase(notes, notes, files, events).undoAvailable('source-0')).toBeUndefined();
  });

  it('rolls back an interrupted migration and resumes on next startup without losing existing notes', async () => {
    await db.close();
    db = new Database(new NodeSqliteDriver(path), MIGRATIONS.map(item => item.version === 27
      ? { ...item, sql: `${item.sql}\n-- @@split\nINSERT INTO missing_acceptance_table VALUES (1)` } : item));
    await expect(db.migrate()).rejects.toThrow('missing_acceptance_table');
    expect((await db.listMigrations()).at(-1)?.version).toBe(26);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'note_organization_batches'")).toEqual([]);
    expect((await reopen()).map(item => item.version)).toEqual([27, 28, 29, 30, 31, 32]);
    expect(await notes.findByIds(originals.map(note => note.id))).toEqual(originals);
    expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });

  it('preserves confirmation history if rebuilding its table fails and upgrades the previous candidate on retry', async () => {
    await db.close();
    db = new Database(new NodeSqliteDriver(path), MIGRATIONS.filter(item => item.version <= 28));
    await db.migrate();
    const before = await db.select('SELECT * FROM action_proposals ORDER BY id');
    await db.close();
    db = new Database(new NodeSqliteDriver(path), MIGRATIONS.map(item => item.version === 29
      ? { ...item, sql: `${item.sql}\n-- @@split\nINSERT INTO missing_confirmation_table VALUES (1)` } : item));
    await expect(db.migrate()).rejects.toThrow('missing_confirmation_table');
    expect((await db.listMigrations()).at(-1)?.version).toBe(28);
    expect(await db.select('SELECT * FROM action_proposals ORDER BY id')).toEqual(before);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'action_proposals_before_knowledge'")).toEqual([]);
    expect((await reopen()).map(item => item.version)).toEqual([29, 30, 31, 32]);
    expect(await db.select('SELECT * FROM action_proposals ORDER BY id')).toEqual(before);
    expect(await db.select("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_action_proposals_%' ORDER BY name"))
      .toEqual([{ name: 'idx_action_proposals_created_at' }, { name: 'idx_action_proposals_status' }]);
    await expect(db.execute("UPDATE action_proposals SET action_type = 'unknown_action' WHERE id = 'legacy-pending'"))
      .rejects.toThrow('CHECK constraint');
  });
});
