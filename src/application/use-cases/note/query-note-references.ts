import type { KnowledgeLinkRepository, LinkRelationType, NoteRepository } from '../../ports';
import { parseWikiLinks } from '@domain/note/wiki-link';

export interface NoteReference {
  noteId: string;
  title: string;
  kind: 'card' | 'topic' | 'link' | 'related';
  relationType?: LinkRelationType;
  reason?: string;
  charStart?: number;
  anchor?: string;
  quotes: Array<{ quote: string; reason?: string; group?: string }>;
  stale: boolean;
}

const PAGE_SIZE = 20;

/** Read confirmed provenance locally; a reference is not a proof of semantic agreement. */
export class QueryNoteReferencesUseCase {
  constructor(private readonly notes: NoteRepository, private readonly links?: KnowledgeLinkRepository) {}

  async connections(noteId: string, direction: 'incoming' | 'outgoing' | 'related', offset = 0) {
    if (direction === 'incoming') return this.execute(noteId, offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid reference offset');
    const source = await this.notes.findById(noteId);
    if (!source) return { items: [] as NoteReference[], hasMore: false, sourceMissing: true };
    const items: NoteReference[] = [];
    if (direction === 'related') {
      const links = await this.links?.query({ entity: { type: 'note', id: noteId }, onlyConfirmed: true, limit: 10001 }) ?? [];
      for (const link of links) {
        if (!link.confirmedByUser || link.archivedAt || link.relationType === 'review_later' || link.fromType !== 'note' || link.toType !== 'note') continue;
        const otherId = link.fromId === noteId ? link.toId : link.fromId;
        if (otherId === noteId) continue;
        const target = await this.notes.findById(otherId);
        if (target) items.push({ noteId: otherId, title: target.title, kind: 'related', relationType: link.relationType,
          reason: link.reason, quotes: [], stale: false });
        if (items.length >= offset + PAGE_SIZE + 1) break;
      }
    } else {
      const refs = new Map<string, { kind: 'card' | 'topic' | 'link'; quotes: NoteReference['quotes']; hash?: string; title?: string }>();
      if (source.cardSource) refs.set(source.cardSource.noteId, { kind: 'card', quotes: [{ quote: source.cardSource.quote }], hash: source.cardSource.contentHash, title: source.cardSource.title });
      for (const group of source.topicPage?.groups ?? []) for (const member of group.members) {
        const snapshot = source.topicPage?.sources.find(item => item.noteId === member.noteId);
        const ref = refs.get(member.noteId) ?? { kind: 'topic', quotes: [], hash: snapshot?.contentHash, title: snapshot?.title };
        ref.quotes.push({ quote: member.quote, reason: member.reason, group: group.title }); refs.set(member.noteId, ref);
      }
      for (const title of new Set(parseWikiLinks(source.content).map(link => link.title))) {
        const targets = await this.notes.findByTitle(title);
        if (targets.length === 1 && !refs.has(targets[0].id)) refs.set(targets[0].id, { kind: 'link', quotes: [] });
      }
      for (const [id, ref] of refs) {
        if (id === noteId) continue;
        const target = await this.notes.findById(id);
        const quote = ref.quotes[0]?.quote;
        const stale = !target || (ref.kind !== 'link' && (target.contentHash !== ref.hash || ref.quotes.some(item => !target.content.includes(item.quote))));
        items.push({ noteId: id, title: target?.title ?? ref.title ?? id, kind: ref.kind, stale,
          quotes: ref.quotes.length ? ref.quotes : target ? [{ quote: target.content.slice(0, 180) }] : [],
          charStart: !stale && quote ? target?.content.indexOf(quote) : undefined,
          anchor: !stale ? quote : undefined });
      }
    }
    return { items: items.slice(offset, offset + PAGE_SIZE), hasMore: items.length > offset + PAGE_SIZE, sourceMissing: false };
  }

  async execute(noteId: string, offset = 0): Promise<{ items: NoteReference[]; hasMore: boolean; sourceMissing: boolean }> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid reference offset');
    const [source, referring] = await Promise.all([
      this.notes.findById(noteId), this.notes.findReferencingNotes(noteId, PAGE_SIZE + 1, offset),
    ]);
    const items = referring.slice(0, PAGE_SIZE).map(note => {
      const card = note.cardSource?.noteId === noteId ? note.cardSource : undefined;
      const topicQuotes = note.topicPage?.groups.flatMap(group =>
        group.members.filter(member => member.noteId === noteId)
          .map(member => ({ quote: member.quote, reason: member.reason, group: group.title }))) ?? [];
      const snapshot = card ?? (topicQuotes.length ? note.topicPage?.sources.find(item => item.noteId === noteId) : undefined);
      const inline = source ? parseWikiLinks(note.content).find(link => link.title === source.title) : undefined;
      const anchor = inline ? note.content.slice(inline.start, inline.end) : undefined;
      const quotes = card ? [{ quote: card.quote }] : topicQuotes.length ? topicQuotes : inline ? [{
        quote: note.content.slice(Math.max(0, inline.start - 60), Math.min(note.content.length, inline.end + 100)),
      }] : [];
      const kind = card ? 'card' as const : topicQuotes.length ? 'topic' as const : 'link' as const;
      return {
        noteId: note.id, title: note.title, kind, quotes,
        charStart: kind === 'link' ? inline?.start : undefined,
        anchor: kind === 'link' ? anchor : undefined,
        stale: kind !== 'link' && (!source || !snapshot || snapshot.contentHash !== source.contentHash ||
          quotes.some(item => !source.content.includes(item.quote))),
      };
    });
    return { items, hasMore: referring.length > PAGE_SIZE, sourceMissing: !source };
  }
}
