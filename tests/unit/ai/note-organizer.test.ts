import { describe, expect, it, vi } from 'vitest';
import { NoteOrganizer } from '@ai/knowledge/note-organizer';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';

describe('note card generation', () => {
  it('requests English output and structured quotes without translating evidence', async () => {
    const complete = vi.fn(async (_request: ModelCompletionRequest) => JSON.stringify({ cards: [
      { title: 'Search', body: 'Requires sorted input.', quote: '二分查找要求输入有序，否则无法保证正确性。' },
    ] }));
    const organizer = new NoteOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => {});
    const result = await organizer.draft('二分查找要求输入有序，否则无法保证正确性。', 'en');
    expect(result).toHaveLength(1);
    expect(complete.mock.calls[0][0].system).toContain('Write titles and bodies in English');
    expect(complete.mock.calls[0][0].system).toContain('Never translate or paraphrase quote');
  });
  it('rejects invalid JSON without returning template cards', async () => {
    const complete = vi.fn(async () => 'not JSON');
    const organizer = new NoteOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => {});
    await expect(organizer.draft('learning content', 'zh')).rejects.toThrow('DeepSeek');
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('cannot generate when access is denied', async () => {
    const complete = vi.fn(async () => '[]');
    const organizer = new NoteOrganizer(new ModelRouter({ isAvailable: async () => true, complete }), async () => { throw new Error('disabled'); });
    await expect(organizer.draft('note', 'en')).rejects.toThrow('disabled');
    expect(complete).not.toHaveBeenCalled();
  });
});
