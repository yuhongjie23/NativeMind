import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { FileImportPort, GenerationOptions, Note, NoteCardDraft, NoteCardRepository, NoteCardsProposal, NoteOrganizationPort, NoteOrganizationProgress, NoteRepository } from '../../ports';
import { newId, now } from '../../shared/utils';
import { nextOrganizationBatch, reviewedPrefix } from '@domain/note/organization-batch';

export { MAX_ORGANIZATION_CHARS } from '@domain/note/organization-batch';

/** Verify exact contiguous evidence, not a model-generated offset or paraphrased quote. */
export function validateNoteCards(cards: NoteCardDraft[], source: string): void {
  if (!Array.isArray(cards) || cards.length > 8) throw new Error('知识卡片格式无效，请重新整理。');
  const quotes = new Set<string>();
  for (const card of cards) {
    if (typeof card.title !== 'string' || !card.title.trim() || card.title.length > 120
      || typeof card.body !== 'string' || !card.body.trim() || card.body.length > 2000
      || typeof card.quote !== 'string' || card.quote.trim().length < 12 || card.quote.length > 1800) {
      throw new Error('知识卡片格式无效，请重新整理。');
    }
    const start = source.indexOf(card.quote);
    if (start < 0 || source.indexOf(card.quote, start + 1) >= 0 || quotes.has(card.quote)) {
      throw new Error('部分卡片的原文依据无法唯一定位，请重新整理。');
    }
    quotes.add(card.quote);
  }
}

export class OrganizeNoteUseCase {
  private readonly running = new Set<string>();
  constructor(
    private readonly notes: NoteRepository,
    private readonly cards: NoteCardRepository | undefined,
    private readonly organization: NoteOrganizationPort | undefined,
    private readonly files: FileImportPort,
    private readonly confirmation: ConfirmationService,
    private readonly events: EventBus,
    private readonly jobs?: { prioritizeInteractive?(): () => void },
  ) {}

  listCards(sourceId: string): Promise<Note[]> { return this.cards?.listCards(sourceId) ?? Promise.resolve([]); }

  async progress(sourceId: string): Promise<NoteOrganizationProgress | undefined> {
    const source = await this.notes.findById(sourceId);
    if (!source || !this.cards) return undefined;
    const all = await this.cards.listOrganizationBatches(sourceId);
    const batches = all.filter(item => item.sourceHash === source.contentHash);
    return { totalChars: source.content.length, reviewedChars: reviewedPrefix(batches, source.content.length),
      reviewedBatches: batches.length, sourceChanged: all.length > 0 && batches.length === 0,
      nextBatch: nextOrganizationBatch(source.content, batches) };
  }

  /** User-initiated reset changes only progress, never the saved cards. */
  async restart(sourceId: string): Promise<void> {
    if (this.running.has(sourceId)) throw new Error('这篇笔记正在整理，请完成或取消后再试。');
    this.running.add(sourceId);
    try {
      await this.cards?.resetOrganizationBatches(sourceId);
      await this.events.publish({ type: 'NoteOrganizationProgressChanged', noteId: sourceId, timestamp: now() });
    }
    finally { this.running.delete(sourceId); }
  }

  async execute(noteId: string, language: 'zh' | 'en', options?: GenerationOptions & { onCommit?: () => void }): Promise<Note[]> {
    if (this.running.has(noteId)) throw new Error('这篇笔记正在整理，请完成或取消后再试。');
    this.running.add(noteId);
    try { return await this.executeBatch(noteId, language, options); }
    finally { this.running.delete(noteId); }
  }

  private async executeBatch(noteId: string, language: 'zh' | 'en', options?: GenerationOptions & { onCommit?: () => void }): Promise<Note[]> {
    const organization = this.organization;
    const repository = this.cards;
    if (!organization || !repository) throw new Error('浏览器演示模式不支持 DeepSeek 知识整理，请使用桌面版。');
    options?.signal?.throwIfAborted();
    await organization.requireAccess();
    const source = await this.notes.findById(noteId);
    if (!source) throw new Error('原笔记已不存在，无法整理。');
    const previous = (await repository.listOrganizationBatches(noteId)).filter(item => item.sourceHash === source.contentHash);
    const batch = nextOrganizationBatch(source.content, previous);
    if (!batch) return [];
    const text = source.content.slice(batch.inputStart, batch.end);
    const release = this.jobs?.prioritizeInteractive?.();
    let drafts: NoteCardDraft[];
    try { drafts = await organization.draft(text, language, batch.inputStart < batch.start
      ? { ...options, contextPrefixChars: batch.start - batch.inputStart } : options); }
    finally { release?.(); }
    options?.signal?.throwIfAborted();
    await organization.requireAccess();
    validateNoteCards(drafts, text);
    const payload: NoteCardsProposal = {
      sourceId: source.id, sourceHash: source.contentHash, sourceTitle: source.title,
      analyzedChars: text.length, totalChars: source.content.length, cards: drafts, batch,
    };
    const result = await this.confirmation.confirmAndCommit({
      actionType: 'create_note_cards', summary: language === 'en' ? 'Review knowledge cards before saving' : '检查知识卡片后保存', payload,
    }, async selected => {
      await organization.requireAccess();
      const current = await this.notes.findById(source.id);
      if (!current || current.contentHash !== source.contentHash || current.content !== source.content) {
        throw new Error('原笔记已修改或删除，请重新整理后保存。');
      }
      validateNoteCards(selected.cards, text);
      const timestamp = now();
      const notes: Note[] = await Promise.all(selected.cards.map(async card => {
        const charStart = batch.inputStart + text.indexOf(card.quote);
        if (charStart + card.quote.length <= batch.start) throw new Error('卡片仅引用了上一段的上下文，请取消并重新整理。');
        return {
          id: newId(), title: card.title.trim(), content: card.body.trim(),
          contentHash: await this.files.hash(card.body.trim()), sourceType: 'manual',
          indexStatus: 'pending', tags: [...source.tags], createdAt: timestamp, updatedAt: timestamp,
          cardSource: { noteId: source.id, title: source.title, contentHash: source.contentHash,
            quote: card.quote, charStart, charEnd: charStart + card.quote.length },
        };
      }));
      const saved = await repository.commitCards(source.id, source.contentHash, notes, {
        ...batch, sourceId: source.id, sourceHash: source.contentHash, reviewedAt: timestamp,
      });
      await this.events.publish({ type: 'NoteOrganizationProgressChanged', noteId: source.id, timestamp });
      for (const note of saved) {
        await this.events.publish({ type: 'NoteImported', noteId: note.id, sourceType: 'text', timestamp });
      }
      return saved;
    }, options);
    return result.result ?? [];
  }
}
