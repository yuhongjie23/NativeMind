import { parseWikiLinks } from './wiki-link';

export interface WikiLinkEdit { start: number; end: number; before: string; after: string }

/** Change only the target title, preserving whitespace, labels, code and ordinary mentions. */
export function renameWikiLinks(content: string, oldTitle: string, newTitle: string) {
  const edits: WikiLinkEdit[] = [];
  for (const link of parseWikiLinks(content)) {
    if (link.title !== oldTitle) continue;
    const raw = content.slice(link.start + 2, link.end - 2);
    if (raw.length - oldTitle.length + newTitle.length > 500) throw new Error('更新后的链接过长，请先缩短链接别名。');
    const target = raw.split('|')[0];
    const start = link.start + 2 + target.length - target.trimStart().length;
    edits.push({ start, end: start + oldTitle.length, before: oldTitle, after: newTitle });
  }
  let updated = content;
  for (const edit of [...edits].reverse()) updated = updated.slice(0, edit.start) + edit.after + updated.slice(edit.end);
  return { content: updated, edits };
}

export function offsetAfterWikiRename(offset: number, edits: WikiLinkEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (offset <= edit.start) break;
    if (offset < edit.end) return edit.start + delta + Math.min(offset - edit.start, edit.after.length);
    delta += edit.after.length - (edit.end - edit.start);
  }
  return offset + delta;
}
