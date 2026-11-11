// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StandardizeNote } from '@ui/components/features/StandardizeNote';
import { StandardNoteConfirmation } from '@ui/components/features/StandardNoteConfirmation';
import type { Note } from '@application/ports';
import { EN } from '@ui/i18n/en';

const state = vi.hoisted(() => ({ blocked: undefined as string | undefined, execute: vi.fn(), refresh: vi.fn(async () => {}) }));
vi.mock('@ui/hooks/use-knowledge-organization', () => ({ useKnowledgeOrganization: () => state.blocked }));
vi.mock('@ui/stores/settings-store', () => ({ useSettingsStore: (select: (value: { language: string }) => unknown) => select({ language: 'en' }) }));
vi.mock('@ui/stores/runtime', () => ({ describeError: String, useCases: { standardizeNote: { execute: state.execute } } }));
vi.mock('@ui/stores/note-store', () => ({ useNoteStore: { getState: () => ({ refresh: state.refresh }) } }));
vi.mock('@ui/stores/knowledge-link-store', () => ({ useKnowledgeLinkStore: { getState: () => ({ refresh: state.refresh }) } }));
vi.mock('@ui/i18n', () => ({ useT: () => (key: string) => EN[key] ?? key }));
vi.mock('@ui/components/common/Modal', () => ({ Modal: ({ children, footer }: { children: ReactNode; footer: ReactNode }) =>
  createElement('div', null, children, footer) }));
const note: Note = { id: 'test', title: 'Source', content: 'A meaningful test note about study methods.', contentHash: 'one',
  sourceType: 'manual', indexStatus: 'indexed', tags: [], createdAt: '', updatedAt: '' };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); state.blocked = undefined; state.execute.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('discloses the complete text upload and disables generation when unavailable or oversized', async () => {
  state.blocked = 'DeepSeek is disabled';
  await act(async () => root.render(createElement(StandardizeNote, { note, onOpen: () => {} })));
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(host.textContent).toContain('Send the complete text to DeepSeek');
  expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  state.blocked = undefined;
  await act(async () => root.render(createElement(StandardizeNote, { note: { ...note, content: 'x'.repeat(12001) }, onOpen: () => {} })));
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(host.textContent).toContain('will not silently truncate');
  expect(state.execute).not.toHaveBeenCalled();
});

it('offers opening the saved copy after the use case completes', async () => {
  const saved = { ...note, id: 'copy', title: 'Organized' };
  state.execute.mockResolvedValue(saved);
  const onOpen = vi.fn();
  await act(async () => root.render(createElement(StandardizeNote, { note, onOpen })));
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toContain('The original is unchanged');
  const open = [...host.querySelectorAll('button')].find(button => button.textContent === 'Open organized note');
  await act(async () => open!.click());
  expect(onOpen).toHaveBeenCalledWith(saved);
});

it('previews source and draft as escaped text and saves only on explicit approval', async () => {
  const approve = vi.fn();
  const reject = vi.fn();
  await act(async () => root.render(createElement(StandardNoteConfirmation, { onApprove: approve, onReject: reject,
    proposal: { sourceTitle: 'Source', original: '<script>bad()</script>', title: 'Organized', content: 'Source: Source\n\n## Overview\n\n<script>bad()</script>' } })));
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toContain('Compare with the complete original note');
  expect(approve).not.toHaveBeenCalled();
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Save as a new organized note');
  await act(async () => save!.click());
  expect(approve).toHaveBeenCalledOnce();
  expect(reject).not.toHaveBeenCalled();
});
