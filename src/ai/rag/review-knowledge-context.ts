/** Exclude historical model prose and explicitly unconfirmed records from structured context.
 * Plain text is used by confirmed knowledge-link summaries; it remains source data, not instructions.
 */
export function reviewKnowledgeContext(value: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return value; }
  const clean = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(clean).filter(item => item !== undefined);
    if (!entry || typeof entry !== 'object') return entry;
    const record = entry as Record<string, unknown>;
    if (record.confirmed === false || record.provenance === 'ai_draft') return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (key === 'previousReview' || key === 'oldAIReview') continue;
      const cleaned = clean(child);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length ? result : undefined;
  };
  const cleaned = clean(parsed);
  return cleaned === undefined ? '' : JSON.stringify(cleaned);
}
