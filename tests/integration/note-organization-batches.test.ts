import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NodeSqliteDriver } from './sqlite-driver';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { ConfirmationService, type ConfirmationPrompt } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { OrganizeNoteUseCase } from '@application/use-cases/note/organize-note';
import { nextOrganizationBatch } from '@domain/note/organization-batch';
import type { FileImportPort, Note, NoteCardsProposal, NoteOrganizationPort } from '@application/ports';

const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
const content = Array.from({ length: 160 }, (_, i) => `Section ${i}: This is a unique learning passage about concept ${i}. ${'Detailed explanations and examples. '.repeat(7)}`).join('\n\n');

describe('persistent section-by-section organization', () => {
  let db: Database;
  let notes: SqliteNoteRepository;
  let source: Note;
  const files: FileImportPort = { hash, parse: async () => { throw new Error('unused'); } };
  beforeEach(async () => {
    db = new Database(new NodeSqliteDriver()); await db.migrate(); notes = new SqliteNoteRepository(db);
    source = { id: 'long-note', title: 'Long material', content, contentHash: await hash(content),
      sourceType: 'imported_text', tags: [], indexStatus: 'indexed', createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' };
    await notes.save(source);
  });
  afterEach(async () => db.close());

  function setup(prompt: ConfirmationPrompt = async () => true) {
    const organization: NoteOrganizationPort = {
      requireAccess: vi.fn(async () => {}),
      draft: vi.fn(async (text, _language, options) => {
        const quote = text.slice(options?.contextPrefixChars ?? 0).split('\n\n')[0];
        return [{ title: quote.slice(0, 35), body: 'An editable summary of this section.', quote }];
      }),
    };
    const useCase = new OrganizeNoteUseCase(notes, notes, organization, files,
      new ConfirmationService(new SqliteActionProposalRepository(db), prompt), new SimpleEventBus());
    return { useCase, organization };
  }

  it('resumes in a fresh use case and maps quotes in later sections to global offsets', async () => {
    const first = setup();
    await first.useCase.execute(source.id, 'en');
    const p = await first.useCase.progress(source.id);
    expect(p?.reviewedBatches).toBe(1);
    const next = setup();
    const [card] = await next.useCase.execute(source.id, 'en');
    expect(card.cardSource?.charStart).toBe(p?.reviewedChars);
    expect(source.content.slice(card.cardSource!.charStart, card.cardSource!.charEnd)).toBe(card.cardSource?.quote);
    expect(next.organization.draft).toHaveBeenCalledWith(expect.any(String), 'en', expect.objectContaining({ contextPrefixChars: expect.any(Number) }));
  });

  it('rejecting or failing a section does not advance progress', async () => {
    const rejected = setup(async () => false);
    await rejected.useCase.execute(source.id, 'en');
    expect((await rejected.useCase.progress(source.id))?.reviewedChars).toBe(0);
    vi.mocked(rejected.organization.draft).mockRejectedValueOnce(new Error('network failure'));
    await expect(rejected.useCase.execute(source.id, 'en')).rejects.toThrow('network failure');
    expect((await rejected.useCase.progress(source.id))?.reviewedChars).toBe(0);
  });

  it('requires explicit confirmation for empty results and permits declining all cards', async () => {
    const prompt = vi.fn(async (proposal) => {
      (proposal.payload as NoteCardsProposal).cards = []; return true;
    });
    const { useCase, organization } = setup(prompt);
    vi.mocked(organization.draft).mockResolvedValueOnce([]);
    await useCase.execute(source.id, 'en');
    await useCase.execute(source.id, 'en');
    expect(prompt).toHaveBeenCalledTimes(2);
    expect((await useCase.progress(source.id))?.reviewedBatches).toBe(2);
    expect(await notes.listCards(source.id)).toEqual([]);
  });

  it('starts a revised document from zero without deleting old cards', async () => {
    const { useCase } = setup(); await useCase.execute(source.id, 'en');
    const changed = `A newly added paragraph.\n\n${content}`;
    await notes.save({ ...source, content: changed, contentHash: await hash(changed) });
    expect(await useCase.progress(source.id)).toMatchObject({ reviewedChars: 0, sourceChanged: true });
    expect(await notes.listCards(source.id)).toHaveLength(1);
  });

  it('atomically rolls back cards, index jobs and progress when recording progress fails', async () => {
    await db.execute("CREATE TRIGGER fail_progress BEFORE INSERT ON note_organization_batches BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const { useCase } = setup();
    await expect(useCase.execute(source.id, 'en')).rejects.toThrow('disk full');
    expect(await notes.listCards(source.id)).toEqual([]);
    expect(await notes.listOrganizationBatches(source.id)).toEqual([]);
    expect(await db.select('SELECT id FROM background_jobs')).toEqual([]);
  });

  it('rejects a stale batch commit without changing an already reviewed section', async () => {
    const batch = nextOrganizationBatch(content, [])!;
    const record = { ...batch, sourceId: source.id, sourceHash: source.contentHash, reviewedAt: source.createdAt };
    await notes.commitCards(source.id, source.contentHash, [], record);
    await expect(notes.commitCards(source.id, source.contentHash, [], record)).rejects.toThrow('进度已变化');
    expect(await notes.listOrganizationBatches(source.id)).toHaveLength(1);
  });

  it('prevents concurrent generation and reset while a proposal is awaiting confirmation', async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let finish!: (value: boolean) => void;
    const waiting = new Promise<boolean>(resolve => { finish = resolve; });
    const { useCase } = setup(async () => { entered(); return waiting; });
    const run = useCase.execute(source.id, 'en'); await ready;
    await expect(useCase.execute(source.id, 'en')).rejects.toThrow('正在整理');
    await expect(useCase.restart(source.id)).rejects.toThrow('正在整理');
    finish(false); await run;
    expect((await useCase.progress(source.id))?.reviewedChars).toBe(0);
  });

  it('processes all sections on demand and makes no further model call at completion', async () => {
    const { useCase, organization } = setup();
    let count = 0;
    while ((await useCase.progress(source.id))?.nextBatch) {
      await useCase.execute(source.id, 'en'); count++;
      expect(count).toBeLessThan(10);
    }
    expect((await useCase.progress(source.id))?.reviewedChars).toBe(content.length);
    expect(await useCase.execute(source.id, 'en')).toEqual([]);
    expect(organization.draft).toHaveBeenCalledTimes(count);
    const before = await notes.listCards(source.id);
    await useCase.restart(source.id);
    expect((await useCase.progress(source.id))?.reviewedChars).toBe(0);
    expect(await notes.listCards(source.id)).toHaveLength(before.length);
    await useCase.execute(source.id, 'en');
    expect(await notes.listCards(source.id)).toHaveLength(before.length);
  });
});
