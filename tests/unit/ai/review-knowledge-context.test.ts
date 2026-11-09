import { describe, expect, it } from 'vitest';
import { reviewKnowledgeContext } from '@ai/rag/review-knowledge-context';

describe('复盘上下文来源隔离', () => {
  it('不把旧 AI 总结、旧建议或明确未确认记录作为新事实', () => {
    const context = reviewKnowledgeContext(JSON.stringify({
      oldAIReview: { summary: '已经完全掌握' }, previousReview: { summary: '推断情绪', suggestions: ['扩大学习范围'] },
      records: [{ confirmed: false, text: '未确认断言' }, { provenance: 'ai_draft', text: '模型草稿' }, { confirmed: true, text: '保留明确记录' }],
      latestUserSelfReport: { difficulty: '右边界仍然不清楚' },
    }));
    expect(context).toContain('右边界仍然不清楚');
    expect(context).toContain('保留明确记录');
    expect(context).not.toMatch(/完全掌握|推断情绪|扩大学习范围|未确认断言|模型草稿/);
  });
  it('仅有历史 AI 内容时不建立知识证据；保留已确认知识链接摘要', () => {
    expect(reviewKnowledgeContext('{"oldAIReview":{"summary":"进步很大"}}')).toBe('');
    const links = '- 《二分查找》 —前置知识→ 《有序数组》';
    expect(reviewKnowledgeContext(links)).toBe(links);
  });
});
