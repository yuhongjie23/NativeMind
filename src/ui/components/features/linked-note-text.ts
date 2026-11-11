import type { WikiLink } from '@domain/note/wiki-link';

/** Preserve every UTF-16 character so find and saved reading positions stay aligned. */
export function partitionLinkedText(content: string, links: WikiLink[], selection?: { start: number; end: number }) {
  const boundaries = new Set([0, content.length]);
  for (const link of links) { boundaries.add(link.start); boundaries.add(link.end); }
  if (selection) {
    boundaries.add(Math.max(0, Math.min(content.length, selection.start)));
    boundaries.add(Math.max(0, Math.min(content.length, selection.end)));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  let cursor = 0;
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    while (cursor < links.length && links[cursor].end <= start) cursor++;
    const link = links[cursor]?.start <= start && links[cursor]?.end >= end ? links[cursor] : undefined;
    return { start, text: content.slice(start, end), link,
      highlighted: Boolean(selection && start >= selection.start && end <= selection.end) };
  });
}
