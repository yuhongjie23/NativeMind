import { describe, expect, it } from 'vitest';
import { chunkText } from '@ai/rag/chunk-strategy';

describe('chunk text remains an exact contiguous source slice', () => {
  it.each(['markdown', 'pdf', 'text'] as const)('preserves whitespace offsets for %s', type => {
    const source = '\n\n  # 第一章\n\n   正文开始。\n\n\n\n下一段内容。\n\n' + '长段落。'.repeat(900) + '\n\n\n结尾';
    const chunks = chunkText(source, type);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(source.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
      expect(chunk.text.length).toBeLessThanOrEqual(1500);
    }
  });
  it('accounts for leading whitespace immediately after markdown headings', () => {
    const source = '# Title\n\n  The evidence starts here.\n';
    const [chunk] = chunkText(source, 'markdown');
    expect(chunk.offset).toBe(source.indexOf('The evidence'));
    expect(chunk.headingPath).toEqual(['Title']);
  });
  it('does not insert blank lines when merging a hard-split paragraph tail', () => {
    const source = 'x'.repeat(1700);
    const chunks = chunkText(source, 'text');
    expect(chunks.map(c => c.text).join('')).toBe(source);
    for (const c of chunks) expect(source.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });
  it('does not merge across a repeated heading omitted from chunk text', () => {
    const source = '# Same\n'+'a'.repeat(800)+'\n\n# Same\nShort body.';
    const chunks = chunkText(source, 'markdown');
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(source.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });
  it('respects max length when packing paragraphs near the target size', () => {
    const chunks = chunkText('a'.repeat(790)+'\n\n'+'b'.repeat(790), 'text');
    expect(chunks).toHaveLength(2);
    expect(chunks.every(c => c.text.length <= 1500)).toBe(true);
  });
});
