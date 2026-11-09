import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Note } from '@application/ports';
vi.mock('../../../src/ui/stores/runtime', () => ({ aiMode: 'model' }));
vi.mock('../../../src/ui/i18n', () => ({ useT: () => (text: string) => text }));
vi.mock('../../../src/ui/stores/note-store', () => ({
  useNoteStore: (select: (state: unknown) => unknown) => select({ retryingIndex: {}, retryIndex: vi.fn(), refreshIndex: vi.fn() }),
}));
import { NoteIndexStatus } from '@ui/demo/fullscreen-cozy-home/components/NoteIndexStatus';

describe('note index status messages', () => {
  it.each([
    ['pending', undefined, '等待后台索引'],
    ['pending', 'disk unavailable', '索引暂时失败，等待自动重试'],
    ['failed', 'disk unavailable', '索引失败'],
    ['indexed', undefined, '索引已完成'],
    ['indexed', 'vector unavailable', '索引降级为关键词检索'],
  ] as const)('%s / %s shows %s', (indexStatus, indexError, expected) => {
    const html = renderToStaticMarkup(createElement(NoteIndexStatus, { note: { id: 'note', indexStatus, indexError } as Note }));
    expect(html).toContain(`<p role="status">${expected}</p>`);
    if (indexError) expect(html).toContain(indexError);
    else expect(html).not.toContain('等待自动重试');
  });
});
