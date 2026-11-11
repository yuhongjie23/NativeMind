import { describe, expect, it, vi } from 'vitest';
import { extractKeywords } from '@ai/rag/query-keywords';
import { expandQuery } from '@ai/rag/query-expansion';
import { getSchema, toDecodingSchema } from '@ai/schemas';
import { MAX_REVIEW_SOURCES } from '@ai/rag/qa-evidence-review';

describe('query keyword quality', () => {
  it('keeps meaningful words at the end of a Chinese question', () => {
    const query = '为什么孩子不需要用表现来换取母亲的爱？';
    const words = extractKeywords(query);
    expect(words).toEqual(expect.arrayContaining(['孩子', '表现', '换取', '母亲']));
    expect(words).not.toContain('为什');
    expect(words).not.toContain('用表');
    expect(expandQuery(query).slice(1).join(' ')).toContain('母亲');
  });
  it('preserves short technical phrases and removes English question scaffolding', () => {
    expect(extractKeywords('提取率 知识图谱')).toEqual(['提取率', '知识图谱']);
    expect(extractKeywords('Which normalization replaces the LayerNorm?')).toEqual(['normalization', 'replaces', 'layernorm']);
    expect(extractKeywords('LoRA 微调 LoRA', 1)).toEqual(['lora']);
  });
  it('still extracts keywords on older webviews without a segmenter', async () => {
    vi.resetModules();
    const original = Intl.Segmenter;
    try {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
      const fallback = await import('@ai/rag/query-keywords');
      expect(fallback.extractKeywords('学习知识关联')).toContain('知识');
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: original });
      vi.resetModules();
    }
  });
  it('constrains reviewer relevance while decoding, not just after generation', () => {
    const schema = toDecodingSchema(getSchema('qa-critic.v2'));
    expect(schema).toMatchObject({ properties: { relevance: { enum: expect.arrayContaining([0, 0.5, 1]) } } });
    expect(schema).toMatchObject({ properties: { evidence: { items: { properties: {
      source: { enum: Array.from({ length: MAX_REVIEW_SOURCES }, (_, i) => i + 1) },
    } } } } });
  });
});
