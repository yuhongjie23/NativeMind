import { offsetAfterWikiRename, renameWikiLinks } from '@domain/note/rename-wiki-links';
import type { EventBus } from '../../events/event-bus';
import type { FileImportPort, NoteRenamePlan, NoteRenameRepository, NoteRepository } from '../../ports';
import { newId, now } from '../../shared/utils';
import { collectRenameSources, RENAME_STALE } from './rename-note-snapshot';

export interface NoteRenamePreview {
  ticket: string;
  newTitle: string;
  ambiguous: boolean;
  linkCount: number;
  notes: Array<{ title: string; linkCount: number; samples: Array<{ before: string; after: string }> }>;
}

export class RenameNoteUseCase {
  private readonly previews = new Map<string, NoteRenamePlan>();
  private lastRename?: NoteRenamePlan;
  private writing = false;
  constructor(private readonly notes: NoteRepository, private readonly writes: NoteRenameRepository | undefined,
    private readonly files: FileImportPort, private readonly events: EventBus) {}

  async preview(noteId: string, title: string): Promise<NoteRenamePreview> {
    if (!this.writes) throw new Error('当前运行环境不支持关联改名。');
    const newTitle = title.trim();
    if (!newTitle || newTitle.length > 120 || /[[\]|#^\r\n]/.test(newTitle)) throw new Error('标题需要 1–120 个字符，且不能包含链接分隔符或换行。');
    const source = await this.notes.findById(noteId);
    if (!source) throw new Error(RENAME_STALE);
    if (source.title === newTitle) throw new Error('新标题与原标题相同。');
    if ((await this.notes.findByTitle(newTitle)).length) throw new Error('新标题已被其他笔记使用，请换一个标题。');
    const oldTitleUnique = (await this.notes.findByTitle(source.title)).length === 1;
    const candidates = await collectRenameSources(this.notes, source, oldTitleUnique);
    const changes: NoteRenamePlan['changes'] = [];
    const summaries: NoteRenamePreview['notes'] = [];
    const timestamp = now();
    for (const before of candidates) {
      const result = oldTitleUnique && !before.topicPage ? renameWikiLinks(before.content, source.title, newTitle) : { content: before.content, edits: [] };
      const changed = result.edits.length > 0;
      const after = { ...before, title: before.id === noteId ? newTitle : before.title, content: result.content,
        contentHash: changed ? await this.files.hash(result.content) : before.contentHash,
        indexStatus: changed ? 'stale' as const : before.indexStatus, updatedAt: timestamp,
        ...(changed && before.pageRanges ? { pageRanges: before.pageRanges.map(range => ({ ...range,
          start: offsetAfterWikiRename(range.start, result.edits), end: offsetAfterWikiRename(range.end, result.edits) })) } : {}),
        ...(before.id === noteId && before.topicPage ? { topicPage: { ...before.topicPage, title: newTitle } } : {}),
      };
      changes.push({ before, after, linkCount: result.edits.length });
      summaries.push({ title: before.title, linkCount: result.edits.length, samples: result.edits.slice(0, 3).map(edit => {
        const start = Math.max(0, edit.start - 35); const end = Math.min(before.content.length, edit.end + 35);
        return { before: before.content.slice(start, end), after: before.content.slice(start, edit.start) + edit.after + before.content.slice(edit.end, end) };
      }) });
    }
    const ticket = newId();
    // Bound abandoned previews; cancel/unmount explicitly releases its ticket too.
    if (this.previews.size >= 5) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(ticket, { sourceId: noteId, oldTitle: source.title, newTitle, oldTitleUnique, changes });
    return { ticket, newTitle, ambiguous: !oldTitleUnique, linkCount: changes.reduce((sum, change) => sum + change.linkCount, 0), notes: summaries };
  }

  discard(ticket: string): void { this.previews.delete(ticket); }

  undoAvailable(noteId: string): { oldTitle: string; newTitle: string } | undefined {
    const plan = this.lastRename;
    return plan?.sourceId === noteId ? { oldTitle: plan.oldTitle, newTitle: plan.newTitle } : undefined;
  }

  /** Session-scoped exact reversal, not a new global search-and-replace. */
  async undo(noteId: string) {
    const original = this.lastRename;
    if (this.writing) throw new Error('改名操作正在保存，请稍后再试。');
    if (!original || original.sourceId !== noteId || !this.writes) throw new Error('本次运行没有可撤销的改名。');
    const timestamp = now();
    const reversed: NoteRenamePlan = {
      sourceId: noteId, oldTitle: original.newTitle, newTitle: original.oldTitle, oldTitleUnique: true,
      changes: original.changes.map(change => ({ before: change.after, linkCount: change.linkCount,
        after: { ...change.before, updatedAt: timestamp,
          indexStatus: change.before.content !== change.after.content ? 'stale' : change.before.indexStatus },
      })),
    };
    this.writing = true;
    try {
      await this.writes.commitRename(reversed);
      this.lastRename = undefined;
      await this.publishChanges(reversed);
      return (await this.notes.findById(noteId))!;
    } catch (error) {
      if (error instanceof Error && error.message === RENAME_STALE) throw new Error('改名后内容或引用已变化，无法安全撤销。请保留当前内容并手动调整。');
      if (error instanceof Error && error.message === '新标题已被其他笔记使用，请换一个标题。') throw new Error('原标题已被占用，无法安全撤销。');
      throw error;
    } finally { this.writing = false; }
  }

  async execute(ticket: string) {
    if (this.writing) throw new Error('改名操作正在保存，请稍后再试。');
    const plan = this.previews.get(ticket);
    if (!plan || !this.writes) throw new Error(RENAME_STALE);
    this.previews.delete(ticket);
    this.writing = true;
    try {
      await this.writes.commitRename(plan);
      this.lastRename = plan;
      await this.publishChanges(plan);
      return (await this.notes.findById(plan.sourceId))!;
    } finally { this.writing = false; }
  }

  private async publishChanges(plan: NoteRenamePlan): Promise<void> {
    // Index jobs were committed with the text; these events refresh local readers only.
    for (const change of plan.changes) await this.events.publish({ type: 'NoteUpdated', noteId: change.after.id,
      contentChanged: change.before.content !== change.after.content, indexQueued: true, timestamp: change.after.updatedAt });
  }
}
