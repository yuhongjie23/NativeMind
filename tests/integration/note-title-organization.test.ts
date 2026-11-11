import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { FileImportPort, Note, NoteTitleDraft } from '@application/ports';
import { OrganizeNoteTitleUseCase } from '@application/use-cases/note/organize-note-title';
import { RenameNoteUseCase } from '@application/use-cases/note/rename-note';
import { ConfirmationService } from '@application/confirmation/confirmation-service';
import { SimpleEventBus } from '@application/events/event-bus';
import { Database } from '@infrastructure/db/database';
import { SqliteNoteRepository } from '@infrastructure/db/repositories/note-repository';
import { SqliteActionProposalRepository } from '@infrastructure/db/repositories/support-repositories';
import { NodeSqliteDriver } from './sqlite-driver';

const content = '茶多酚提取需要控制温度、时间和溶剂比例。应根据原料和实验条件比较提取率。';
const source: Note = { id: 'source', title: 'sohu.com https://www.sohu.com', content, contentHash: 'initial', sourceType: 'manual',
  indexStatus: 'indexed', tags: [], createdAt: '2026-11-10', updatedAt: '2026-11-10' };
const files: FileImportPort = { hash: async text => createHash('sha256').update(text).digest('hex'), parse: async () => { throw new Error('unused'); } };
const valid: NoteTitleDraft = { status: 'suggested', title: '茶多酚提取条件与提取率', reason: '正文讨论温度、时间和溶剂条件。', quote: content };

describe('AI note titles with real confirmation persistence', () => {
  let db: Database;
  let notes: SqliteNoteRepository;
  let rename: RenameNoteUseCase;
  beforeEach(async () => {
    db = new Database(new NodeSqliteDriver()); await db.migrate(); notes = new SqliteNoteRepository(db);
    await notes.save(source);
    await notes.save({ ...source, id: 'ref', title: '实验记录', content: `见 [[${source.title}|出处]]。` });
    rename = new RenameNoteUseCase(notes, notes, files, new SimpleEventBus());
  });
  afterEach(async () => db.close());
  function build(draft = vi.fn(async () => valid), prompt = vi.fn(async () => true), access = vi.fn(async () => {})) {
    return new OrganizeNoteTitleUseCase(notes, { draft, requireAccess: access }, rename,
      new ConfirmationService(new SqliteActionProposalRepository(db), prompt));
  }
  it('keeps the old name until approval, then updates links and allows session undo', async () => {
    const prompt = vi.fn(async () => {
      expect((await notes.findById('source'))?.title).toBe(source.title);
      expect((await db.selectOne('SELECT action_type FROM action_proposals'))?.action_type).toBe('rename_note');
      return true;
    });
    const result = await build(undefined, prompt).execute('source', 'zh');
    expect(result.status).toBe('saved');
    expect((await notes.findById('ref'))?.content).toContain(`[[${valid.title}|出处]]`);
    expect((await db.selectOne('SELECT status FROM action_proposals'))?.status).toBe('confirmed');
    await rename.undo('source'); expect((await notes.findById('source'))?.title).toBe(source.title);
  });
  it('does not rename rejected or insufficient drafts', async () => {
    expect((await build(undefined, vi.fn(async () => false)).execute('source', 'zh')).status).toBe('cancelled');
    expect((await build(vi.fn(async () => ({ ...valid, status: 'insufficient', title: '', quote: '' }))).execute('source', 'zh')).status).toBe('insufficient');
    expect((await notes.findById('source'))?.title).toBe(source.title);
  });
  it.each([{ ...valid, quote: '这是原文里根本不存在的内容不能作为依据' }, { ...valid, title: 'https://example.com' }])('rejects unsupported evidence or URL titles', async draft => {
    await expect(build(vi.fn(async () => draft)).execute('source', 'zh')).rejects.toThrow('原文依据');
    expect(await db.select('SELECT * FROM action_proposals')).toHaveLength(0);
  });
  it('blocks unconfigured access before sending text and caps the excerpt', async () => {
    const draft = vi.fn(async () => valid);
    await expect(build(draft, undefined, vi.fn(async () => { throw new Error('disabled'); })).execute('source', 'zh')).rejects.toThrow('disabled');
    expect(draft).not.toHaveBeenCalled();
    await notes.save({ ...source, content: content + 'x'.repeat(10000) });
    await build(draft).execute('source', 'en');
    expect(draft.mock.calls[0]).toEqual([expect.any(String), 'en', undefined]);
    expect((draft.mock.calls as unknown as [string][])[0][0]).toHaveLength(6000);
  });
  it('rejects a changed note during generation and while awaiting approval', async () => {
    await expect(build(vi.fn(async () => { await notes.save({ ...source, content: 'Changed' }); return valid; })).execute('source', 'zh')).rejects.toThrow('已修改');
    await notes.save(source);
    await expect(build(undefined, vi.fn(async () => { await notes.save({ ...source, title: 'User title' }); return true; })).execute('source', 'zh')).rejects.toThrow('已修改');
    expect((await notes.findById('source'))?.title).toBe('User title');
  });
  it('cancellation after generation never proposes or writes a title', async () => {
    const controller = new AbortController();
    await expect(build(vi.fn(async () => { controller.abort(); return valid; })).execute('source', 'zh', { signal: controller.signal })).rejects.toThrow();
    expect(await db.select('SELECT * FROM action_proposals')).toHaveLength(0);
  });
});
