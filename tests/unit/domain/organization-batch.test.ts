import { describe, expect, it } from 'vitest';
import { MAX_ORGANIZATION_CHARS, nextOrganizationBatch, reviewedPrefix, type OrganizationRange } from '@domain/note/organization-batch';

describe('long note organization boundaries', () => {
  it.each(['a'.repeat(60000), '学习笔记🙂🧠\n\n'.repeat(5000), '内容没有换行🙂'.repeat(5000)])('covers the whole document without gaps, oversized inputs or broken surrogate pairs', content => {
    const ranges: OrganizationRange[] = [];
    let cursor = 0;
    while (cursor < content.length) {
      const batch = nextOrganizationBatch(content, ranges)!;
      expect(batch.start).toBe(cursor);
      expect(batch.end).toBeGreaterThan(cursor);
      expect(batch.end - batch.inputStart).toBeLessThanOrEqual(MAX_ORGANIZATION_CHARS);
      const text = content.slice(batch.inputStart, batch.end);
      expect(/^[\uDC00-\uDFFF]/.test(text)).toBe(false);
      expect(/[\uD800-\uDBFF]$/.test(text)).toBe(false);
      ranges.push(batch); cursor = batch.end;
    }
    expect(reviewedPrefix(ranges, content.length)).toBe(content.length);
    expect(nextOrganizationBatch(content, ranges)).toBeUndefined();
  });

  it('prefers a nearby paragraph boundary', () => {
    const content = 'a'.repeat(11000) + '\n\n' + 'b'.repeat(4000);
    expect(nextOrganizationBatch(content, [])?.end).toBe(11002);
  });

  it('does not count disjoint or invalid ranges as completed progress', () => {
    expect(reviewedPrefix([{ start: 50, end: 100 }, { start: 0, end: 20 }, { start: 0, end: 2000 }], 100)).toBe(20);
    expect(nextOrganizationBatch('', [])).toBeUndefined();
  });
});
