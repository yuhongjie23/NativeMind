import { describe, expect, it } from 'vitest';
import { findTextMatches, resolveDocumentOffset } from '@ui/components/features/document-find';
describe('document find and anchors', () => {
  it('matches literal regex characters, English case and original UTF-16 offsets', () => {
    const text = '😀Ab[c] 中文 ab[C]';
    expect(findTextMatches(text, 'ab[c]')).toEqual([{ start: 2, end: 7 }, { start: 11, end: 16 }]);
    expect(findTextMatches('İ i I', 'i').map(hit => hit.start)).toEqual([2, 4]);
  });
  it('handles empty, missing, repeated and multiline text', () => {
    expect(findTextMatches('哈哈哈哈', '哈哈')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(findTextMatches('a\nb a\nb', 'a\nb')).toHaveLength(2);
    expect(findTextMatches('内容', '')).toEqual([]);
    expect(findTextMatches('内容', '不存在')).toEqual([]);
  });
  it('chooses nearest repeated anchor, handles zero and bad offsets', () => {
    expect(resolveDocumentOffset('same xx same xx same', 16, 'same')).toBe(16);
    expect(resolveDocumentOffset('text', 0)).toBe(0);
    expect(resolveDocumentOffset('text', NaN)).toBeUndefined();
    expect(resolveDocumentOffset('text', 100, 'text')).toBe(0);
  });
});
