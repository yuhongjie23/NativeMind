import { describe, expect, it, vi } from 'vitest';
import { TopicOrganizer } from '@ai/knowledge/topic-organizer';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';

describe('DeepSeek topic draft adapter', () => {
  it('supports explicit no-group results and enforces language and evidence instructions', async () => {
    const complete = vi.fn(async (_request: ModelCompletionRequest) => '{"title":"Different subjects","groups":[]}');
    const organizer = new TopicOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => {});
    expect((await organizer.draft([], 'en')).groups).toEqual([]);
    expect(complete.mock.calls[0][0].system).toContain('Write titles and reasons in English');
    expect(complete.mock.calls[0][0].system).toContain('Same topic does not imply synonymous concepts');
  });
  it('does not return a template topic after malformed model output', async () => {
    const complete = vi.fn(async () => 'bad json');
    const organizer = new TopicOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => {});
    await expect(organizer.draft([], 'zh')).rejects.toThrow('DeepSeek');
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
