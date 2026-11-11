import type { Note, NoteGraphReference } from '@application/ports';
import { parseWikiLinks } from '@domain/note/wiki-link';

/** Resolve against the whole title index, even when the graph shows only a subset. */
export async function collectGraphReferences(notes: AsyncIterable<Note>, visible: Set<string>, limit: number,
  resolve: (title: string) => Promise<string | undefined>): Promise<NoteGraphReference[]> {
  const results = new Map<string, NoteGraphReference>();
  const titles = new Map<string, string | undefined>();
  const add = (fromId: string, toId: string, kind: NoteGraphReference['kind']) => {
    if (fromId !== toId && visible.has(fromId) && visible.has(toId)) results.set(JSON.stringify([fromId, toId, kind]), { fromId, toId, kind });
  };
  for await (const note of notes) {
    if (note.cardSource) add(note.id, note.cardSource.noteId, 'card');
    for (const group of note.topicPage?.groups ?? []) for (const member of group.members) {
      add(note.id, member.noteId, 'topic');
      if (results.size >= limit) return [...results.values()].slice(0, limit);
    }
    for (const link of parseWikiLinks(note.content)) {
      if (!titles.has(link.title)) titles.set(link.title, await resolve(link.title));
      const target = titles.get(link.title);
      if (target) add(note.id, target, 'link');
      if (results.size >= limit) return [...results.values()].slice(0, limit);
    }
    if (results.size >= limit) break;
  }
  return [...results.values()].slice(0, limit);
}
