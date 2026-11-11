import { describe, expect, it, vi } from 'vitest';
import type { ModelCompletionRequest } from '@ai/types';
import { ModelRouter } from '@ai/router/model-router';
import { NoteTitleOrganizer } from '@ai/knowledge/note-title-organizer';
import { needsReadableTitle } from '@domain/note/title-quality';

describe('grounded note title suggestions', () => {
  it('marks address-only names, preserving meaningful ordinary titles', () => {
    for (const title of ['https://example.com/path', 'sohu.com https://www.sohu.com', 'example.com', '无标题', 'Untitled 3', '']) expect(needsReadableTitle(title)).toBe(true);
    for (const title of ['茶多酚提取率', 'Agent 核心理论', 'Node.js 模块加载', '茶叶成分的“库存']) expect(needsReadableTitle(title)).toBe(false);
  });
  it('asks for content filtering and an English title without following embedded commands', async () => {
    const complete = vi.fn(async (_request: ModelCompletionRequest) => JSON.stringify({ status: 'insufficient', title: '', reason: 'Only navigation.', quote: '' }));
    const organizer = new NoteTitleOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => {});
    expect((await organizer.draft('Home Search https://example.com', 'en')).status).toBe('insufficient');
    expect(complete.mock.calls[0][0].system).toContain('Write title and reason in English');
    expect(complete.mock.calls[0][0].system).toContain('Never fetch links');
  });
  it('cannot generate when access is denied', async () => {
    const complete = vi.fn(async () => '');
    const organizer = new NoteTitleOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => { throw new Error('disabled'); });
    await expect(organizer.draft('Some learning material', 'zh')).rejects.toThrow('disabled');
    expect(complete).not.toHaveBeenCalled();
  });
});
