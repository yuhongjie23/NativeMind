import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { ConfirmationService, type ConfirmationPrompt } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { ComposeTopicUseCase } from '@application/use-cases/note/compose-topic';
import type { FileImportPort, Note, TopicDraft, TopicOrganizationPort, TopicProposal } from '@application/ports';
import { NodeSqliteDriver } from './sqlite-driver';

const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
const quotes = ['Binary search requires sorted input to safely discard half the candidates.',
  'Lower bound finds the first element greater than or equal to the target.'];
const draft: TopicDraft = { title: 'Searching sorted arrays', groups: [{ title: 'Related search techniques', members: quotes.map((quote, i) => ({
  noteId: `note-${i}`, quote, reason: 'Discusses searching sorted input while preserving its distinct objective.',
})) }] };

describe('topic composition: local persistence and confirmation', () => {
  let db: Database;
  let notes: SqliteNoteRepository;
  let originals: Note[];
  const files: FileImportPort = { hash, parse: async () => { throw new Error('unused'); } };
  beforeEach(async () => {
    db = new Database(new NodeSqliteDriver()); await db.migrate(); notes = new SqliteNoteRepository(db);
    originals = await Promise.all(quotes.map(async (content, i): Promise<Note> => ({
      id: `note-${i}`, title: `Source ${i}`, content, contentHash: await hash(content), sourceType: 'manual',
      tags: [], indexStatus: 'indexed', createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z',
    })));
    for (const note of originals) await notes.save(note);
  });
  afterEach(async () => db.close());
  function setup(prompt: ConfirmationPrompt = async () => true, output: TopicDraft = draft) {
    const organization: TopicOrganizationPort = { requireAccess: vi.fn(async () => {}), draft: vi.fn(async () => structuredClone(output)) };
    const proposals = new SqliteActionProposalRepository(db);
    const release = vi.fn();
    const useCase = new ComposeTopicUseCase(notes, notes, organization, files,
      new ConfirmationService(proposals, prompt), new SimpleEventBus(), { prioritizeInteractive: () => release });
    return { useCase, organization, proposals, release };
  }
  const ids = ['note-0', 'note-1'];

  it('confirms an edited topic title and persists snapshots without changing either source', async () => {
    let proposalId = '';
    const deps = setup(async proposal => {
      proposalId = proposal.id;
      expect(await notes.listAll()).toHaveLength(2);
      proposal.payload = { ...(proposal.payload as TopicProposal), title: 'My topic' }; return true;
    });
    const page = await deps.useCase.execute(ids, 'en');
    expect(page?.title).toBe('My topic');
    expect(page?.topicPage?.groups).toEqual(draft.groups);
    expect((await deps.proposals.findById(proposalId))?.payload).toMatchObject({ title: 'My topic' });
    expect((await deps.proposals.findById(proposalId))?.status).toBe('confirmed');
    expect(await notes.findByIds(ids)).toEqual(originals);
    expect(await db.select('SELECT entity_id FROM background_jobs')).toEqual([{ entity_id: page?.id }]);
    expect(deps.release).toHaveBeenCalledOnce();
  });

  it('refusal and cancellation leave no topic or index jobs', async () => {
    expect(await setup(async () => false).useCase.execute(ids, 'en')).toBeUndefined();
    const controller = new AbortController();
    await expect(setup(async () => { controller.abort(); return true; }).useCase.execute(ids, 'en', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await notes.listAll()).toHaveLength(2);
    expect(await db.select('SELECT id FROM background_jobs')).toEqual([]);
  });

  it('no meaningful groups means no confirmation or fabricated theme', async () => {
    const prompt = vi.fn(async () => true);
    expect(await setup(prompt, { title: 'No supported group', groups: [] }).useCase.execute(ids, 'en')).toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each(['invented-id', 'fake-quote', 'duplicate-id'])('rejects %s before confirmation', async kind => {
    const invalid = structuredClone(draft);
    if (kind === 'invented-id') invalid.groups[0].members[0].noteId = 'not-selected';
    if (kind === 'fake-quote') invalid.groups[0].members[0].quote = 'This quote is not present in the selected source.';
    if (kind === 'duplicate-id') invalid.groups[0].members[1] = { ...invalid.groups[0].members[0] };
    const prompt = vi.fn(async () => true);
    await expect(setup(prompt, invalid).useCase.execute(ids, 'en')).rejects.toThrow();
    expect(prompt).not.toHaveBeenCalled();
    expect(await notes.listAll()).toHaveLength(2);
  });

  it('detects source revisions after the preview was generated', async () => {
    const deps = setup(async () => {
      await notes.save({ ...originals[0], content: 'Changed source', contentHash: await hash('Changed source') }); return true;
    });
    await expect(deps.useCase.execute(ids, 'en')).rejects.toThrow('已修改或删除');
    expect(await notes.listAll()).toHaveLength(2);
  });

  it('reuses the same sources in another order and preserves user edits', async () => {
    const deps = setup(); const page = (await deps.useCase.execute(ids, 'en'))!;
    await notes.save({ ...page, title: 'User changed title', tags: ['my-topic'] });
    const again = await deps.useCase.execute([...ids].reverse(), 'en');
    expect(again?.id).toBe(page.id); expect(again?.title).toBe('User changed title');
    expect(await db.select('SELECT id FROM background_jobs')).toHaveLength(1);
  });

  it('rolls back a page when index job insertion fails', async () => {
    await db.execute("CREATE TRIGGER fail_topic_job BEFORE INSERT ON background_jobs BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(setup().useCase.execute(ids, 'en')).rejects.toThrow('disk full');
    expect(await notes.listAll()).toHaveLength(2);
  });

  it('deleting a topic never deletes its source notes', async () => {
    const page = (await setup().useCase.execute(ids, 'en'))!;
    await notes.delete(page.id);
    expect(await notes.findByIds(ids)).toEqual(originals);
  });

  it('deleting a source preserves the topic snapshot for explanation', async () => {
    const page = (await setup().useCase.execute(ids, 'en'))!;
    await notes.delete(ids[0]);
    expect((await notes.findById(page.id))?.topicPage?.sources[0].excerpt).toBe(quotes[0]);
  });

  it('bounds input to selected excerpts and rejects invalid selection sizes', async () => {
    await notes.save({ ...originals[0], content: quotes[0] + 'x'.repeat(10000) });
    const deps = setup();
    await deps.useCase.execute(ids, 'en');
    const sources = vi.mocked(deps.organization.draft).mock.calls[0][0];
    expect(sources).toHaveLength(2); expect(sources.every(source => source.excerpt.length <= 1500)).toBe(true);
    await expect(deps.useCase.execute(['note-0'], 'en')).rejects.toThrow('2–8');
    await expect(deps.useCase.execute(Array.from({ length: 9 }, (_, i) => `n${i}`), 'en')).rejects.toThrow('2–8');
  });

  it('checks cloud consent before reading notes or generating', async () => {
    const deps = setup(); vi.mocked(deps.organization.requireAccess).mockRejectedValue(new Error('API Key required'));
    await expect(deps.useCase.execute(ids, 'en')).rejects.toThrow('API Key');
    expect(deps.organization.draft).not.toHaveBeenCalled();
  });
});
