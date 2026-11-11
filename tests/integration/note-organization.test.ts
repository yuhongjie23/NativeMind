import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { NodeSqliteDriver } from './sqlite-driver';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { ConfirmationService, type ConfirmationPrompt } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { OrganizeNoteUseCase, MAX_ORGANIZATION_CHARS } from '@application/use-cases/note/organize-note';
import type { FileImportPort, Note, NoteCardDraft, NoteCardsProposal, NoteOrganizationPort } from '@application/ports';

const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
const quote = 'Binary search requires sorted input and halves the search interval.';
const second = 'The loop ends when the search interval contains no remaining candidates.';
const drafts: NoteCardDraft[] = [{ title: 'Binary search', body: 'Search sorted input by halving the interval.', quote }];

describe('knowledge cards: confirmation and real SQLite persistence', () => {
  let db: Database;
  let notes: SqliteNoteRepository;
  let source: Note;
  let proposals: SqliteActionProposalRepository;
  const files: FileImportPort = { hash, parse: async () => { throw new Error('unused parser'); } };
  beforeEach(async () => {
    db = new Database(new NodeSqliteDriver()); await db.migrate();
    notes = new SqliteNoteRepository(db);
    source = { id: 'source', title: 'Algorithms', content: `${quote}\n\n${second}`, contentHash: await hash(`${quote}\n\n${second}`),
      sourceType: 'manual', tags: ['algorithms'], indexStatus: 'indexed', createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' };
    await notes.save(source);
    proposals = new SqliteActionProposalRepository(db);
  });
  afterEach(async () => db.close());
  function setup(prompt: ConfirmationPrompt = async () => true, output = drafts) {
    const organization: NoteOrganizationPort = { requireAccess: vi.fn(async () => {}), draft: vi.fn(async () => structuredClone(output)) };
    const release = vi.fn();
    const useCase = new OrganizeNoteUseCase(notes, notes, organization, files,
      new ConfirmationService(proposals, prompt), new SimpleEventBus(), { prioritizeInteractive: () => release });
    return { useCase, organization, release };
  }
  it('saves edited selections through confirmation, keeps the original and queues indexing', async () => {
    let proposalId = '';
    const { useCase, release } = setup(async proposal => {
      proposalId = proposal.id;
      expect(await notes.listCards(source.id)).toEqual([]);
      const payload = proposal.payload as NoteCardsProposal;
      proposal.payload = { ...payload, cards: [{ ...payload.cards[0], title: 'My title', body: 'My corrected explanation.' }] };
      return true;
    });
    const [card] = await useCase.execute(source.id, 'en');
    expect(card.title).toBe('My title');
    expect(card.cardSource).toMatchObject({ noteId: source.id, quote, charStart: 0, charEnd: quote.length });
    expect((await notes.findById(source.id))?.content).toBe(source.content);
    expect(await db.select('SELECT entity_id FROM background_jobs')).toEqual([{ entity_id: card.id }]);
    expect((await proposals.findById(proposalId))?.payload).toMatchObject({ cards: [{ title: 'My title' }] });
    expect((await proposals.findById(proposalId))?.status).toBe('confirmed');
    expect(release).toHaveBeenCalledOnce();
  });
  it('rejecting the proposal writes no notes or index jobs', async () => {
    const { useCase } = setup(async () => false);
    expect(await useCase.execute(source.id, 'en')).toEqual([]);
    expect(await notes.listCards(source.id)).toEqual([]);
    expect(await db.select('SELECT id FROM background_jobs')).toEqual([]);
    expect(await db.select('SELECT status FROM action_proposals')).toEqual([{ status: 'rejected' }]);
  });
  it('repeated extraction reuses an existing card without overwriting user edits', async () => {
    const { useCase } = setup();
    const [card] = await useCase.execute(source.id, 'en');
    await notes.save({ ...card, content: 'User revision', contentHash: await hash('User revision') });
    await useCase.restart(source.id);
    const [again] = await useCase.execute(source.id, 'en');
    expect(again.id).toBe(card.id);
    expect(again.content).toBe('User revision');
    expect(await notes.listCards(source.id)).toHaveLength(1);
    expect(await db.select('SELECT id FROM background_jobs')).toHaveLength(1);
  });
  it('rejects fabricated, ambiguous and duplicate source quotes before prompting', async () => {
    const prompt = vi.fn(async () => true);
    await expect(setup(prompt, [{ ...drafts[0], quote: 'An invented passage not present in the note.' }]).useCase.execute(source.id, 'en')).rejects.toThrow('无法唯一定位');
    await expect(setup(prompt, [drafts[0], drafts[0]]).useCase.execute(source.id, 'en')).rejects.toThrow('无法唯一定位');
    await notes.save({ ...source, content: `${quote}\n${quote}` });
    await expect(setup(prompt).useCase.execute(source.id, 'en')).rejects.toThrow('无法唯一定位');
    expect(prompt).not.toHaveBeenCalled();
  });
  it('rejects stale source revisions after the preview was shown', async () => {
    const { useCase } = setup(async () => {
      await notes.save({ ...source, content: 'Changed text', contentHash: await hash('Changed text') }); return true;
    });
    await expect(useCase.execute(source.id, 'en')).rejects.toThrow('已修改或删除');
    expect(await notes.listCards(source.id)).toEqual([]);
  });
  it('keeps quote provenance after editing a card and deleting the source', async () => {
    const [card] = await setup().useCase.execute(source.id, 'en');
    await notes.save({ ...card, title: 'Renamed', tags: ['changed'] });
    await notes.delete(source.id);
    expect((await notes.findById(card.id))?.cardSource?.quote).toBe(quote);
  });
  it('cancellation while confirming leaves no saved cards', async () => {
    const controller = new AbortController();
    const { useCase } = setup(async () => { controller.abort(); return true; });
    await expect(useCase.execute(source.id, 'en', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await notes.listCards(source.id)).toEqual([]);
  });
  it('rolls back the whole batch including index jobs if a later card fails', async () => {
    const [card] = await setup().useCase.execute(source.id, 'en');
    await notes.delete(card.id);
    await db.execute('DELETE FROM background_jobs');
    await db.execute("CREATE TRIGGER fail_second BEFORE INSERT ON notes WHEN NEW.id = 'second-card' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const start = source.content.indexOf(second);
    const other: Note = { ...card, id: 'second-card', cardSource: { ...card.cardSource!, quote: second, charStart: start, charEnd: start + second.length } };
    await expect(notes.commitCards(source.id, source.contentHash, [card, other])).rejects.toThrow('disk full');
    expect(await notes.listCards(source.id)).toEqual([]);
    expect(await db.select('SELECT id FROM background_jobs')).toEqual([]);
  });
  it('bounds cloud input and discloses partial analysis in the proposal', async () => {
    const content = `${source.content}\n${'x'.repeat(MAX_ORGANIZATION_CHARS)}`;
    await notes.save({ ...source, content, contentHash: await hash(content) });
    const { useCase, organization } = setup(async proposal => {
      expect(proposal.payload).toMatchObject({ analyzedChars: MAX_ORGANIZATION_CHARS, totalChars: content.length }); return false;
    });
    await useCase.execute(source.id, 'zh');
    expect(organization.draft).toHaveBeenCalledWith(content.slice(0, MAX_ORGANIZATION_CHARS), 'zh', undefined);
  });
  it('requires access before reading a source or invoking generation', async () => {
    const { useCase, organization } = setup();
    vi.mocked(organization.requireAccess).mockRejectedValue(new Error('API Key required'));
    await expect(useCase.execute(source.id, 'zh')).rejects.toThrow('API Key');
    expect(organization.draft).not.toHaveBeenCalled();
  });
});
