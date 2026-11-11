import type { GenerationOptions, NoteRepository, NoteTitlePort } from '../../ports';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { RenameNoteUseCase } from './rename-note';
import { needsReadableTitle } from '@domain/note/title-quality';

export interface NoteTitleProposal { oldTitle: string; newTitle: string; reason: string; quote: string; linkCount: number; ambiguous: boolean }

/** A cloud-generated name remains a draft until the standard write gate approves it. */
export class OrganizeNoteTitleUseCase {
  private readonly running = new Set<string>();
  constructor(private readonly notes: NoteRepository, private readonly ai: NoteTitlePort | undefined,
    private readonly rename: RenameNoteUseCase, private readonly confirmation: ConfirmationService) {}

  async execute(noteId: string, language: 'zh' | 'en', options?: GenerationOptions & { onCommit?: () => void }) {
    if (!this.ai) throw new Error('浏览器演示模式不支持 DeepSeek 知识整理，请使用桌面版。');
    if (this.running.has(noteId)) throw new Error('正在整理这篇笔记的标题，请稍后。');
    this.running.add(noteId);
    let ticket: string | undefined;
    try {
      options?.signal?.throwIfAborted();
      await this.ai.requireAccess();
      const source = await this.notes.findById(noteId);
      if (!source) throw new Error('原笔记已不存在，无法整理。');
      const excerpt = source.content.slice(0, 6000);
      if (excerpt.trim().length < 12) return { status: 'insufficient' as const };
      const draft = await this.ai.draft(excerpt, language, options);
      options?.signal?.throwIfAborted();
      await this.ai.requireAccess();
      if (draft.status === 'insufficient') return { status: 'insufficient' as const };
      const title = draft.title.trim();
      if (draft.status !== 'suggested' || title.length < 2 || title.length > 60 || needsReadableTitle(title)
        || /[[\]|#^\r\n]/.test(title) || !draft.reason.trim() || draft.reason.length > 400
        || draft.quote.trim().length < 12 || draft.quote.length > 500 || !excerpt.includes(draft.quote)) {
        throw new Error('标题建议缺少可靠原文依据，请重新整理或手动命名。');
      }
      const assertCurrent = async () => {
        const current = await this.notes.findById(noteId);
        if (!current || current.title !== source.title || current.content !== source.content || current.contentHash !== source.contentHash)
          throw new Error('原笔记已修改或删除，请重新整理后保存。');
      };
      await assertCurrent();
      if (title === source.title) return { status: 'unchanged' as const };
      const preview = await this.rename.preview(noteId, title);
      ticket = preview.ticket;
      const payload: NoteTitleProposal = { oldTitle: source.title, newTitle: title, reason: draft.reason,
        quote: draft.quote, linkCount: preview.linkCount, ambiguous: preview.ambiguous };
      const result = await this.confirmation.confirmAndCommit({ actionType: 'rename_note',
        summary: language === 'en' ? 'Review the suggested note title' : '检查 AI 建议的笔记标题', payload }, async () => {
        await this.ai!.requireAccess();
        options?.signal?.throwIfAborted();
        await assertCurrent();
        return this.rename.execute(preview.ticket);
      }, options);
      return { status: result.confirmed ? 'saved' as const : 'cancelled' as const, note: result.result };
    } finally { if (ticket) this.rename.discard(ticket); this.running.delete(noteId); }
  }
}
