import type { Note, NoteRenamePlan, NoteRepository } from '../../ports';
import { parseWikiLinks } from '@domain/note/wiki-link';

export const RENAME_STALE = '笔记或链接已变化，请重新预览改名。';

const editingRevision = (note: Note): string => JSON.stringify([
  note.id, note.title, note.content, note.contentHash, note.sourceType, note.sourceUri ?? null,
  note.tags, note.pageRanges ?? null, note.cardSource ?? null, note.topicPage ?? null, note.createdAt, note.updatedAt,
]);

/** Index progress is operational state, not a user edit; never restore an old progress value. */
export const applyRenameSnapshot = (current: Note, after: Note): Note => ({
  ...after, indexStatus: current.content === after.content ? current.indexStatus : after.indexStatus,
  indexError: current.indexError,
});

export async function collectRenameSources(notes: NoteRepository, source: Note, unique: boolean): Promise<Note[]> {
  const candidates = [source];
  if (unique) {
    for (let offset = 0; ; offset += 64) {
      const page = await notes.findReferencingNotes(source.id, 64, offset);
      candidates.push(...page.filter(note => !note.topicPage && parseWikiLinks(note.content).some(link => link.title === source.title)));
      if (candidates.length > 500) throw new Error('关联笔记超过 500 篇，请先分批整理后再改名。');
      if (page.length < 64) break;
    }
  }
  return candidates;
}

/** Called within the repository transaction; catches edits and newly introduced incoming links. */
export async function assertRenameSnapshot(notes: NoteRepository, plan: NoteRenamePlan): Promise<Map<string, Note>> {
  const source = await notes.findById(plan.sourceId);
  if (!source || source.title !== plan.oldTitle) throw new Error(RENAME_STALE);
  if ((await notes.findByTitle(plan.newTitle)).some(note => note.id !== source.id)) throw new Error('新标题已被其他笔记使用，请换一个标题。');
  const unique = (await notes.findByTitle(source.title)).length === 1;
  if (unique !== plan.oldTitleUnique) throw new Error(RENAME_STALE);
  const current = await collectRenameSources(notes, source, unique);
  if (current.length !== plan.changes.length) throw new Error(RENAME_STALE);
  for (const note of current) {
    const expected = plan.changes.find(change => change.before.id === note.id)?.before;
    if (!expected || editingRevision(expected) !== editingRevision(note)) throw new Error(RENAME_STALE);
  }
  return new Map(current.map(note => [note.id, note]));
}
