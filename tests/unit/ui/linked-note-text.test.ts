import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkedNoteText } from '@ui/components/features/LinkedNoteText';

describe('linked note text keyboard targets', () => {
  it('keeps one button per link when a match splits the link into three text segments', () => {
    const content = 'First [[Binary search|boundaries]], then [[Second]].';
    const start = content.indexOf('search');
    const html = renderToStaticMarkup(createElement(LinkedNoteText, {
      content, selection: { start, end: start + 6 }, marker: createRef<HTMLElement>(), onOpen: () => {},
    }));
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html.match(/<mark\b/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>[\s\S]*<mark[^>]*>search<\/mark>[\s\S]*<\/button>/);
  });

  it('renders input as escaped text, never HTML or executable links', () => {
    const html = renderToStaticMarkup(createElement(LinkedNoteText, {
      content: '<script>alert(1)</script> [[<img src=x>|label]]', marker: createRef<HTMLElement>(), onOpen: () => {},
    }));
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img ');
    expect(html).toContain('&lt;script&gt;'); expect(html.match(/<button\b/g)).toHaveLength(1);
  });
});
