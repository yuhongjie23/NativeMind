export interface TextMatch { start: number; end: number }

/** Literal Unicode-aware matching with original UTF-16 offsets. */
export function findTextMatches(content: string, query: string): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(content.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length }));
}

export function resolveDocumentOffset(content: string, charStart?: number, anchor?: string): number | undefined {
  const probe = anchor?.slice(0, 120).trim();
  const valid = charStart !== undefined && Number.isFinite(charStart) && charStart >= 0 && charStart < content.length;
  if (probe) {
    if (valid) {
      let best = -1;
      for (let i = content.indexOf(probe, Math.max(0, charStart - 1500)); i >= 0 && i <= charStart + 1500; i = content.indexOf(probe, i + 1)) {
        if (best < 0 || Math.abs(i - charStart) < Math.abs(best - charStart)) best = i;
      }
      if (best >= 0) return best;
    }
    const found = content.indexOf(probe);
    if (found >= 0) return found;
  }
  return valid ? charStart : undefined;
}
