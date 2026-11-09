import type { NotePageRange, ReadingPosition } from '@application/ports';

/** Read the text at the viewport's top edge; use an explicitly approximate fallback. */
export function captureReadingPosition(element: HTMLElement, content: string, pages?: NotePageRange[]): ReadingPosition | undefined {
  if (!content || !element.getClientRects().length) return undefined;
  const bounds = element.getBoundingClientRect();
  const doc = element.ownerDocument as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const range = doc.caretRangeFromPoint?.(bounds.left + 12, bounds.top + 12);
  let offset = 0;
  let exact = false;
  if (range && element.contains(range.startContainer) && range.startContainer.nodeType === Node.TEXT_NODE) {
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === range.startContainer) { offset += range.startOffset; exact = true; break; }
      offset += node.textContent?.length ?? 0;
    }
  }
  if (!exact) offset = Math.floor(element.scrollTop / Math.max(1, element.scrollHeight) * content.length);
  offset = Math.max(0, Math.min(content.length - 1, offset));
  return { offset, anchor: content.slice(offset, offset + 120), exact,
    page: pages?.find(item => offset >= item.start && offset < item.end)?.page };
}
