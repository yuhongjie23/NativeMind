import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@application/ports';
import { EN } from '@ui/i18n/en';
import { TopicComposer } from '@ui/components/features/TopicComposer';

const state = vi.hoisted(() => ({ blocked: undefined as string | undefined, canConfigure: true, language: 'zh' }));
vi.mock('@ui/hooks/use-knowledge-organization', () => ({ useKnowledgeOrganizationAvailability: () => state }));
vi.mock('@ui/stores/runtime', () => ({ describeError: String, useCases: {} }));
vi.mock('@ui/stores/note-store', () => ({ useNoteStore: {} }));
vi.mock('@ui/stores/settings-store', () => ({ useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock('@ui/i18n', () => ({ useT: () => (key: string, ...args: (string | number)[]) =>
  args.reduce<string>((text, arg, index) => text.split(`{${index}}`).join(String(arg)), state.language === 'en' ? EN[key] ?? key : key) }));
const notes: Note[] = ['One', 'Two'].map(id => ({ id, title: id, content: 'Saved content',
  contentHash: id, sourceType: 'imported_text', indexStatus: 'pending', tags: [], createdAt: '', updatedAt: '' }));
const render = (items = notes) => renderToStaticMarkup(createElement(TopicComposer, {
  notes: items, onOpen: () => {}, onConfigure: () => {}, onImport: () => {},
}));

describe('note guide setup and selection states', () => {
  beforeEach(() => { state.blocked = undefined; state.canConfigure = true; state.language = 'zh'; });

  it('offers setup instead of unusable selection controls when consent is missing', () => {
    state.blocked = 'AI 知识整理未开启。请在设置中了解数据发送范围并开启。';
    const html = render();
    expect(html).toContain('前往设置 DeepSeek');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('生成目录草稿</button>');
    expect(html).toContain('1500');
    expect(html).toContain('先看草稿，再决定保存');
  });

  it('does not offer an impossible setup action in local-only or demo mode', () => {
    state.blocked = 'Anna 纯本地版不支持 DeepSeek 知识整理；仍可手动关联和本地检索。';
    state.canConfigure = false;
    expect(render()).not.toContain('前往设置 DeepSeek');
    expect(render()).not.toContain('type="checkbox"');
  });

  it('requires a selection before drafting and offers import for an empty library', () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>生成目录草稿<\/button>/);
    expect(render().match(/type="checkbox"/g)).toHaveLength(2);
    expect(render([])).toContain('去导入笔记');
    expect(render([])).not.toContain('生成目录草稿</button>');
  });

  it('renders all new guidance in English without translating user notes', () => {
    state.language = 'en';
    const html = render();
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
    expect(html).toContain('Generate a guide draft');
    expect(html).toContain('One');
  });
});
