import { describe, expect, it } from 'vitest';
import { parseWikiLinks } from '@domain/note/wiki-link';
import { partitionLinkedText } from '@ui/components/features/linked-note-text';

describe('wiki link syntax and original reading offsets', () => {
  it('recognizes trimmed titles, labels, Unicode and repeated references', () => {
    const content = '😀 [[ 二分查找 | 边界条件 ]] and [[Binary Search]] / [[二分查找]]';
    const links = parseWikiLinks(content);
    expect(links.map(link => [link.title, link.label])).toEqual([
      ['二分查找', '边界条件'], ['Binary Search', 'Binary Search'], ['二分查找', '二分查找'],
    ]);
    expect(links[0].start).toBe(3);
    expect(content.slice(links[0].start, links[0].end)).toBe('[[ 二分查找 | 边界条件 ]]');
  });

  it('ignores escaped syntax, code spans, fenced code and embedded links', () => {
    const content = '\\[[escaped]] ![[embed]] `[[inline]]`\n```md\n[[code]]\n```\n~~~\n[[code2]]\n~~~\n[[real]]';
    expect(parseWikiLinks(content).map(link => link.title)).toEqual(['real']);
    expect(parseWikiLinks('``multiline\n[[hidden]]\n`` [[visible]]').map(link => link.title)).toEqual(['visible']);
    expect(parseWikiLinks('```\n[[unclosed code]]')).toEqual([]);
  });

  it('leaves malformed, nested, section and block references as ordinary text', () => {
    const content = '[[]] [[ |label]] [[name| ]] [[a|b|c]] [[[nested]]] [[title#heading]] [[title^block]] [[line\nbreak]] [[unclosed';
    expect(parseWikiLinks(content)).toEqual([]);
    expect(parseWikiLinks(`[[${'a'.repeat(501)}]]`)).toEqual([]);
  });

  it('retains raw characters and active highlights even across link boundaries', () => {
    const content = '😀 hello [[Source|label]] world\nend';
    const links = parseWikiLinks(content);
    for (const selection of [undefined, { start: 2, end: 15 }, { start: 13, end: 16 }, { start: 19, end: content.length }]) {
      const parts = partitionLinkedText(content, links, selection);
      expect(parts.map(part => part.text).join('')).toBe(content);
      expect(parts.filter(part => part.highlighted).map(part => part.text).join(''))
        .toBe(selection ? content.slice(selection.start, selection.end) : '');
      expect(parts.filter(part => part.link).map(part => part.text).join('')).toBe('[[Source|label]]');
    }
  });

  it('keeps ordinary long documents in a single text segment', () => {
    const content = 'A long book without wiki links.\n'.repeat(10000);
    expect(partitionLinkedText(content, parseWikiLinks(content))).toHaveLength(1);
  });
});
