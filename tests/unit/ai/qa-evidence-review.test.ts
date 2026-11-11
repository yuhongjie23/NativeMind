import { describe, expect, it } from 'vitest';
import { evidenceSentences, resolveEvidence, isEvidenceAbstention, type IndexedReview } from '@ai/rag/qa-evidence-review';

const review: IndexedReview = { grounded: true, hallucination_risk: false, quality: 9, relevance: 1,
  critique: '', evidence: [{ claim: 1, source: 1, from: 1, to: 1 }] };

describe('numbered evidence keeps original source spans', () => {
  it('merges adjacent evidence for one claim while retaining exact whitespace', () => {
    const source = '实验温度为43度。\r\n  提取持续10分钟。无关信息。';
    const evidence = [{ claim: 1, source: 1, from: 2, to: 2 }, { claim: 1, source: 1, from: 1, to: 1 }];
    const original = structuredClone(evidence);
    expect(resolveEvidence({ ...review, evidence }, '实验在43度下持续10分钟。', [source]))
      .toEqual([{ chunk_id: 'c1', claim: '实验在43度下持续10分钟。', quote: '实验温度为43度。\r\n  提取持续10分钟。' }]);
    expect(evidence).toEqual(original);
  });
  it('does not join different sources, different claims or ranges with gaps', () => {
    const evidence = [
      { claim: 1, source: 1, from: 1, to: 1 }, { claim: 1, source: 1, from: 3, to: 3 },
      { claim: 2, source: 1, from: 2, to: 2 }, { claim: 1, source: 2, from: 2, to: 2 },
    ];
    const resolved = resolveEvidence({ ...review, evidence }, '第一条结论。第二条结论。', ['第一段。中间段。第三段。', '另一来源。不同段落。']);
    expect(resolved).toHaveLength(4);
    expect(resolved.every(item => !item.quote.includes('第一段。中间段。'))).toBe(true);
  });
  it('preserves decimal numbers, CRLF, quotation marks and source positions', () => {
    const text = '  温度为43.5度。\r\n  "It takes 3.5 minutes." Next.\n末句';
    const spans = evidenceSentences(text);
    expect(spans.map(s => s.text)).toEqual(['温度为43.5度。', '"It takes 3.5 minutes."', 'Next.', '末句']);
    for (const span of spans) expect(text.slice(span.start, span.end)).toBe(span.text);
  });
  it('resolves a continuous range including original whitespace, not reconstructed text', () => {
    const source = ' 前提成立。\r\n\r\n  结论成立。';
    expect(resolveEvidence({ ...review, evidence: [{ claim: 2, source: 1, from: 1, to: 2 }] },
      '不展示这句。保留完整的第二句。', [source])).toEqual([
      { chunk_id: 'c1', quote: source.trim(), claim: '保留完整的第二句。' },
    ]);
  });
  it.each([
    { claim: 0 }, { claim: 2 }, { source: 2 }, { from: 0 }, { from: 2 },
    { to: 2 }, { to: 0 }, { claim: 1.5 }, { source: NaN }, { to: Infinity },
  ])('rejects invalid IDs without taking neighbouring text: %j', patch => {
    expect(resolveEvidence({ ...review, evidence: [{ ...review.evidence[0], ...patch }] },
      '完整结论。', ['完整原文。'])).toEqual([]);
  });
  it.each([
    'The reference material does not specify which normalization replaces LayerNorm.',
    'Insufficient evidence.', 'The sources do not provide the author name.',
    '资料不足，不能确定。', '原文没有明确给出日期。',
  ])('does not attach citations to an abstention even if the critic approves: %s', claim => {
    expect(isEvidenceAbstention(claim)).toBe(true);
    expect(resolveEvidence(review, claim, ['Only describes an algorithm.'])).toEqual([]);
  });
  it('does not reject a supported negative fact merely because it contains not', () => {
    expect(resolveEvidence(review, 'Mamba does not require an attention cache.',
      ['Mamba does not require an attention cache.'])).toHaveLength(1);
  });
});
