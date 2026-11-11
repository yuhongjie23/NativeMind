import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { EventBus } from '../../events/event-bus';
import type { FileImportPort, GenerationOptions, Note, NoteRepository, TopicDraft, TopicOrganizationPort, TopicPageRepository, TopicProposal, TopicSource } from '../../ports';
import { newId, now } from '../../shared/utils';

export const MAX_TOPIC_NOTES = 8;
export const TOPIC_EXCERPT_CHARS = 1500;

export function validateTopic(draft: TopicDraft, sources: TopicSource[]): void {
  if (!draft || typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 120
    || !Array.isArray(draft.groups) || draft.groups.length > 6) throw new Error('主题分组格式无效，请重新生成。');
  const byId = new Map(sources.map(source => [source.noteId, source]));
  for (const group of draft.groups) {
    if (!group || typeof group.title !== 'string' || !group.title.trim() || group.title.length > 120
      || !Array.isArray(group.members) || group.members.length < 2 || group.members.length > MAX_TOPIC_NOTES) {
      throw new Error('每个主题分组需要至少两篇笔记，请重新生成。');
    }
    const ids = new Set<string>();
    for (const member of group.members) {
      const source = byId.get(member?.noteId);
      if (!source || ids.has(member.noteId) || typeof member.reason !== 'string' || !member.reason.trim() || member.reason.length > 300
        || typeof member.quote !== 'string' || member.quote.trim().length < 12 || member.quote.length > 800) {
        throw new Error('主题包含无效来源或重复笔记，请重新生成。');
      }
      const start = source.excerpt.indexOf(member.quote);
      if (start < 0 || source.excerpt.indexOf(member.quote, start + 1) >= 0) throw new Error('主题引用无法在选中的笔记中唯一定位，请重新生成。');
      ids.add(member.noteId);
    }
  }
}

export class ComposeTopicUseCase {
  private running = false;
  constructor(private readonly notes: NoteRepository, private readonly topics: TopicPageRepository | undefined,
    private readonly organization: TopicOrganizationPort | undefined, private readonly files: FileImportPort,
    private readonly confirmation: ConfirmationService, private readonly events: EventBus,
    private readonly jobs?: { prioritizeInteractive?(): () => void }) {}

  async execute(noteIds: string[], language: 'zh' | 'en', options?: GenerationOptions & { onCommit?: () => void }): Promise<Note | undefined> {
    if (this.running) throw new Error('主题正在生成，请完成或取消后再试。');
    this.running = true;
    try { return await this.compose(noteIds, language, options); }
    finally { this.running = false; }
  }

  private async compose(noteIds: string[], language: 'zh' | 'en', options?: GenerationOptions & { onCommit?: () => void }): Promise<Note | undefined> {
    const ai = this.organization;
    const repository = this.topics;
    if (!ai || !repository) throw new Error('浏览器演示模式不支持 DeepSeek 知识整理，请使用桌面版。');
    options?.signal?.throwIfAborted();
    await ai.requireAccess();
    const ids = [...new Set(noteIds)];
    if (ids.length < 2 || ids.length > MAX_TOPIC_NOTES) throw new Error('请选择 2–8 篇笔记或知识卡片。');
    const selected = await this.notes.findByIds(ids);
    if (selected.length !== ids.length || selected.some(note => note.topicPage)) throw new Error('部分笔记已删除或是主题页，请重新选择。');
    const sources: TopicSource[] = selected.map(note => ({ noteId: note.id, title: note.title.slice(0, 120), contentHash: note.contentHash,
      excerpt: note.content.slice(0, TOPIC_EXCERPT_CHARS), totalChars: note.content.length }));
    options?.signal?.throwIfAborted();
    const release = this.jobs?.prioritizeInteractive?.();
    let draft: TopicDraft;
    try { draft = await ai.draft(sources, language, options); }
    finally { release?.(); }
    options?.signal?.throwIfAborted();
    await ai.requireAccess();
    validateTopic(draft, sources);
    if (!draft.groups.length) return undefined;
    const result = await this.confirmation.confirmAndCommit<TopicProposal, Note>({
      actionType: 'create_topic_page', summary: language === 'en' ? 'Review topic groups' : '检查主题分组', payload: { ...draft, sources },
    }, async approved => {
      await ai.requireAccess();
      validateTopic(approved, sources);
      if (!approved.groups.length) throw new Error('请至少保留一个主题分组。');
      const usedIds = new Set(approved.groups.flatMap(group => group.members.map(member => member.noteId)));
      const used = sources.filter(source => usedIds.has(source.noteId));
      // Use the original snapshots, never source metadata edited in the confirmation payload.
      const selectionKey = await this.files.hash(JSON.stringify(used.map(source => [source.noteId, source.contentHash]).sort((a, b) => a[0].localeCompare(b[0]))));
      const titleById = new Map(used.map(source => [source.noteId, source.title]));
      const body = approved.groups.map(group => `## ${group.title.trim()}\n\n${group.members.map(member =>
        `### ${titleById.get(member.noteId)}\n\n${member.reason}\n\n> ${member.quote.replace(/\n/g, '\n> ')}`).join('\n\n')}`).join('\n\n');
      const timestamp = now();
      const page: Note = { id: newId(), title: approved.title.trim(), content: body, contentHash: await this.files.hash(body),
        sourceType: 'manual', tags: [], indexStatus: 'pending', createdAt: timestamp, updatedAt: timestamp,
        topicPage: { title: approved.title.trim(), groups: approved.groups, sources: used, selectionKey } };
      const saved = await repository.commitTopic(page);
      if (saved.id === page.id) await this.events.publish({ type: 'NoteImported', noteId: saved.id, sourceType: 'text', timestamp });
      return saved;
    }, options);
    return result.result;
  }
}
