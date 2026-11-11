import { describe, expect, it } from 'vitest';
import { offsetAfterWikiRename, renameWikiLinks } from '@domain/note/rename-wiki-links';

describe('rename wiki links', () => {
  it('changes title tokens only, preserving labels, spaces, escapes and code', () => {
    const text = '😀 [[ Old | label ]] [[Old]] Old \\[[Old]]\n```\n[[Old]]\n```';
    const result = renameWikiLinks(text, 'Old', 'New name');
    expect(result.edits).toHaveLength(2);
    expect(result.content).toBe('😀 [[ New name | label ]] [[New name]] Old \\[[Old]]\n```\n[[Old]]\n```');
    expect(offsetAfterWikiRename(text.length, result.edits)).toBe(result.content.length);
    expect(offsetAfterWikiRename(0, result.edits)).toBe(0);
  });
  it('rejects replacements that would exceed supported link length', () => {
    expect(() => renameWikiLinks(`[[Old|${'x'.repeat(496)}]]`, 'Old', 'Longer title')).toThrow('链接过长');
  });
});
