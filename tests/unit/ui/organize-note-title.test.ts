import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrganizeNoteTitle } from '@ui/components/features/OrganizeNoteTitle';
import { EN } from '@ui/i18n/en';

const state = vi.hoisted(() => ({ blocked: '未配置 DeepSeek API Key，无法开启 AI 知识整理。请前往设置配置。', language: 'en', execute: vi.fn() }));
vi.mock('@ui/hooks/use-knowledge-organization', () => ({ useKnowledgeOrganization: () => state.blocked }));
vi.mock('@ui/stores/settings-store', () => ({ useSettingsStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('@ui/stores/runtime', () => ({ describeError: String, useCases: { organizeNoteTitle: { execute: state.execute } } }));
vi.mock('@ui/stores/note-store', () => ({ useNoteStore: {} }));
vi.mock('@ui/stores/knowledge-link-store', () => ({ useKnowledgeLinkStore: {} }));
vi.mock('@ui/i18n', () => ({ useT: () => (key: string) => EN[key] ?? key }));

describe('AI title entry', () => {
  it('clearly discloses the excerpt scope and blocks unconfigured generation in English', () => {
    const html = renderToStaticMarkup(createElement(OrganizeNoteTitle, { note: {
      id: 'n', title: 'https://example.com', content: 'A source', contentHash: '', sourceType: 'manual',
      indexStatus: 'pending', tags: [], createdAt: '', updatedAt: '',
    } }));
    expect(html).toContain('6,000');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
    expect(state.execute).not.toHaveBeenCalled();
  });
});
