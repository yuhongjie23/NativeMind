// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeGraphExplorer } from '@ui/components/features/graph/KnowledgeGraphExplorer';
import { useKnowledgeGraphViewStore } from '@ui/stores/knowledge-graph-view-store';
import type { LinkGraph } from '@ui/stores/knowledge-link-store';
import { EN } from '@ui/i18n/en';

vi.mock('@ui/i18n', () => ({ useT: () => (key: string, ...args: (string | number)[]) =>
  args.reduce<string>((text, arg, index) => text.split(`{${index}}`).join(String(arg)), EN[key] ?? key) }));
vi.mock('@ui/stores/knowledge-link-store', () => ({ RELATION_LABELS: {
  same_concept: 'same concept', prerequisite: 'prerequisite', example_of: 'example', contrast: 'contrast', extends: 'extends',
} }));

const graph: LinkGraph = { nodes: ['a', 'b'].map(id => ({ id, label: `Note ${id}`, type: 'note', degree: 0 })), links: [],
  references: [{ fromId: 'a', toId: 'b', kind: 'link' }] };
let host: HTMLDivElement;
let root: Root;
let resize: ((width: number, height: number) => void) | undefined;
const view = (source = graph, loading = false, error?: string) => createElement(KnowledgeGraphExplorer,
  { graph: source, loading, error, onOpen: () => {}, onRefresh: () => {} });
const click = async (selector: string) => {
  const target = host.querySelector(selector);
  expect(target).not.toBeNull();
  await act(async () => target!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = (width, height) => callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect() {}
  });
  useKnowledgeGraphViewStore.setState(useKnowledgeGraphViewStore.getInitialState(), true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resize = undefined;
  vi.unstubAllGlobals();
});

describe('graph session navigation', () => {
  it('keeps a local center visible while searching for one of its neighbors', async () => {
    await act(async () => root.render(view()));
    await click('[data-node="a"]');
    await act(async () => useKnowledgeGraphViewStore.getState().setFilters({ local: true, query: 'Note b' }));
    expect(host.querySelector('[data-node="a"]')).not.toBeNull();
    expect(host.querySelector('[data-node="b"]')).not.toBeNull();
    expect(host.textContent).toContain('Search keeps the center note and a connection path');
  });

  it('distinguishes a failed read from an empty library and preserves a retry action', async () => {
    await act(async () => root.render(view({ nodes: [], links: [] }, false, 'Read failed')));
    expect(host.textContent).toContain('Could not load the graph');
    expect(host.textContent).not.toContain('No notes yet');
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Refresh' && !button.disabled)).toBe(true);
  });

  it('explains an unmatched local query and permits opening the retained center', async () => {
    const onOpen = vi.fn();
    await act(async () => root.render(createElement(KnowledgeGraphExplorer, {
      graph, loading: false, onOpen, onRefresh: () => {},
    })));
    await click('[data-node="a"]');
    await act(async () => useKnowledgeGraphViewStore.getState().setFilters({ local: true, query: 'Unmatched' }));
    expect(host.textContent).toContain('No connected notes match within this range');
    expect(host.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    const open = [...host.querySelectorAll('button')].find(button => button.textContent === 'Open note');
    expect(open).toBeDefined();
    await act(async () => open!.click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', label: 'Note a' }));
  });
  it('restores filters, selection, local depth and zoom after leaving and reopening the graph', async () => {
    await act(async () => root.render(view()));
    await click('[data-node="a"]');
    await act(async () => useKnowledgeGraphViewStore.getState().setFilters({ query: 'Note', local: true, depth: 2, showOrphans: false }));
    await click('button[aria-label="Zoom in"]');
    const transform = host.querySelector('svg > g')?.getAttribute('transform');
    expect(transform).toContain('scale(1.25)');
    await act(async () => root.render(null));
    await act(async () => root.render(view()));
    expect((host.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('Note');
    expect(host.querySelector('[data-node="a"]')?.getAttribute('aria-pressed')).toBe('true');
    expect((host.querySelector('select[aria-label]') as HTMLSelectElement).value).toBe('2');
    expect(host.querySelector('svg > g')?.getAttribute('transform')).toBe(transform);
  });

  it('keeps selection by ID and zoom when a note is renamed or relations refresh', async () => {
    await act(async () => root.render(view()));
    await click('[data-node="a"]');
    await click('button[aria-label="Zoom in"]');
    const before = host.querySelector('svg > g')?.getAttribute('transform');
    const renamed = { ...graph, nodes: graph.nodes.map(node => ({ ...node, label: node.id === 'a' ? 'Renamed note' : node.label })) };
    await act(async () => root.render(view(renamed)));
    expect(host.querySelector('[data-node="a"]')?.getAttribute('aria-label')).toContain('Renamed note');
    expect(host.querySelector('[data-node="a"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('svg > g')?.getAttribute('transform')).toBe(before);
  });

  it('does not discard selection during loading or errors; falls back after a successful missing-note result', async () => {
    await act(async () => root.render(view()));
    await click('[data-node="a"]');
    await act(async () => useKnowledgeGraphViewStore.getState().setFilters({ local: true }));
    const empty = { nodes: [], links: [] };
    await act(async () => root.render(view(empty, true)));
    expect(useKnowledgeGraphViewStore.getState().selected).toBe('a');
    await act(async () => root.render(view(empty, false, 'Failed to read notes')));
    expect(useKnowledgeGraphViewStore.getState().selected).toBe('a');
    await act(async () => root.render(view({ ...graph, nodes: graph.nodes.slice(1) })));
    expect(useKnowledgeGraphViewStore.getState().selected).toBeUndefined();
    expect(useKnowledgeGraphViewStore.getState().local).toBe(false);
    expect(host.textContent).toContain('Returned to the global graph');
    expect(host.querySelector('[data-node="b"]')).not.toBeNull();
  });

  it('does not mistake a filtered-out note for a missing note', async () => {
    await act(async () => root.render(view()));
    await click('[data-node="a"]');
    await act(async () => useKnowledgeGraphViewStore.getState().setFilters({ query: 'No match' }));
    expect(host.querySelector('[data-node="a"]')).toBeNull();
    expect(useKnowledgeGraphViewStore.getState().selected).toBe('a');
    await act(async () => useKnowledgeGraphViewStore.getState().clearFilters());
    expect(host.querySelector('[data-node="a"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('adapts saved pan to canvas size and lets the user reset zoom without losing selection', async () => {
    await act(async () => root.render(view()));
    await click('[data-node="a"]');
    await click('button[aria-label="Zoom in"]');
    await act(async () => resize!(400, 300));
    expect(host.querySelector('svg > g')?.getAttribute('transform')).toBe('translate(-50 -37.5) scale(1.25)');
    const reset = [...host.querySelectorAll('button')].find(button => button.textContent === 'Reset view');
    expect(reset).toBeDefined();
    await act(async () => reset!.click());
    expect(host.querySelector('svg > g')?.getAttribute('transform')).toBe('translate(0 0) scale(1)');
    expect(host.querySelector('[data-node="a"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
