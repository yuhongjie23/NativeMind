/** UTF-16 offsets match the document viewer. Context overlap counts toward the input limit. */
export const MAX_ORGANIZATION_CHARS = 12000;
export const ORGANIZATION_CONTEXT_CHARS = 600;

export interface OrganizationRange { start: number; end: number }
export interface OrganizationBatch extends OrganizationRange { inputStart: number }

/** Only the contiguous reviewed prefix counts as progress; gaps must never be skipped. */
export function reviewedPrefix(ranges: OrganizationRange[], total: number): number {
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
      || range.start < 0 || range.end <= range.start || range.end > total) continue;
    if (range.start > cursor) break;
    cursor = Math.max(cursor, range.end);
  }
  return cursor;
}

export function nextOrganizationBatch(content: string, ranges: OrganizationRange[]): OrganizationBatch | undefined {
  const start = reviewedPrefix(ranges, content.length);
  if (start >= content.length) return undefined;
  let inputStart = Math.max(0, start - ORGANIZATION_CONTEXT_CHARS);
  // Avoid splitting surrogate pairs when working with emoji/non-BMP characters.
  if (inputStart > 0 && /[\uDC00-\uDFFF]/.test(content[inputStart])) inputStart--;
  let end = Math.min(content.length, inputStart + MAX_ORGANIZATION_CHARS);
  if (end < content.length) {
    const paragraph = content.lastIndexOf('\n\n', end - 2);
    const line = content.lastIndexOf('\n', end - 1);
    const boundary = paragraph >= end - 2400 ? paragraph + 2 : line + 1;
    if (boundary >= end - 2400 && boundary > start) end = boundary;
    if (/[\uDC00-\uDFFF]/.test(content[end])) end--;
  }
  return { start, end, inputStart };
}
