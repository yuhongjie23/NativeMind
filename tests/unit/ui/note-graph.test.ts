import { describe, expect, it } from 'vitest';
import type { KnowledgeLink } from '@application/ports';
import type { LinkGraph } from '@ui/stores/knowledge-link-store';
import { projectNoteGraph, type GraphFilters } from '@ui/components/features/graph/graph-model';
import { layoutNoteGraph } from '@ui/components/features/graph/graph-layout';

const edge = (fromId: string, toId: string, patch: Partial<KnowledgeLink> = {}): KnowledgeLink => ({
  id: `${fromId}-${toId}`, fromType: 'note', fromId, toType: 'note', toId, relationType: 'extends',
  createdBy: 'user_manual', confirmedByUser: true, createdAt: '', updatedAt: '', ...patch,
});
const graph: LinkGraph = { nodes: ['a', 'b', 'c', 'd', 'orphan'].map(id => ({ id, type: 'note', label: `Note ${id}`, degree: 99 })),
  links: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')] };
const filters: GraphFilters = { query: '', showOrphans: true, depth: 1 };

describe('note graph projection', () => {
  it('keeps the local center and a real path to a matching two-hop note', () => {
    const result = projectNoteGraph(graph, { ...filters, center: 'a', depth: 2, query: 'NOTE C' });
    expect(result.nodes.map(node => node.id)).toEqual(['a', 'b', 'c']);
    expect(result.edges.map(edge => [edge.source, edge.target])).toEqual([['a', 'b'], ['b', 'c']]);
    expect(projectNoteGraph(graph, { ...filters, center: 'a', depth: 1, query: 'NOTE C' }).nodes.map(node => node.id)).toEqual(['a']);
  });

  it('keeps only the center when local search has no match, without bypassing relation filters', () => {
    expect(projectNoteGraph(graph, { ...filters, center: 'a', depth: 2, query: 'missing', showOrphans: false }).nodes.map(node => node.id)).toEqual(['a']);
    const result = projectNoteGraph(graph, { ...filters, center: 'a', depth: 2, query: 'Note c', relation: 'contrast' });
    expect(result.nodes.map(node => node.id)).toEqual(['a']);
    expect(result.edges).toEqual([]);
    expect(projectNoteGraph(graph, { ...filters, center: 'deleted', query: 'Note c' }).nodes).toEqual([]);
  });

  it('supports saved-reference paths without inventing shortcuts or including unrelated matches', () => {
    const source: LinkGraph = { ...graph, links: [], references: [
      { fromId: 'a', toId: 'b', kind: 'link' }, { fromId: 'b', toId: 'c', kind: 'card' },
    ] };
    const snapshot = JSON.stringify(source);
    const result = projectNoteGraph(source, { ...filters, center: 'a', query: 'Note c', depth: 2 });
    expect(result.nodes.map(node => node.id)).toEqual(['a', 'b', 'c']);
    expect(result.edges.some(edge => edge.source === 'a' && edge.target === 'c')).toBe(false);
    expect(projectNoteGraph(source, { ...filters, center: 'a', query: 'Note d', depth: 2 }).nodes.map(node => node.id)).toEqual(['a']);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('handles cycles and several matches without traversing archived or unconfirmed shortcuts', () => {
    const source = { ...graph, links: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'd'),
      edge('a', 'orphan', { confirmedByUser: false }), edge('b', 'orphan', { archivedAt: '2026-11-10' })] };
    const result = projectNoteGraph(source, { ...filters, center: 'a', depth: 2, query: 'Note', showOrphans: false });
    expect(result.nodes.map(node => node.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(result.nodes.map(node => node.id)).size).toBe(result.nodes.length);
    expect(result.edges.every(edge => edge.source !== 'orphan' && edge.target !== 'orphan')).toBe(true);
    expect(projectNoteGraph(source, { ...filters, center: 'a', depth: 2, query: 'orphan' }).nodes.map(node => node.id)).toEqual(['a']);
  });
  it('holds URL titles outside the graph and merges source references with semantic edges', () => {
    const result = projectNoteGraph({ ...graph, nodes: [...graph.nodes, { id: 'url', label: 'sohu.com https://www.sohu.com', type: 'note', degree: 1 }],
      references: [{ fromId: 'a', toId: 'b', kind: 'link' }, { fromId: 'orphan', toId: 'a', kind: 'card' }, { fromId: 'a', toId: 'url', kind: 'link' }] }, filters);
    expect(result.nodes.some(node => node.id === 'url')).toBe(false);
    expect(result.edges).toHaveLength(4);
    expect(result.edges.find(edge => edge.source === 'a' && edge.target === 'b')?.references).toHaveLength(1);
    expect(result.nodes.find(node => node.id === 'orphan')?.degree).toBe(1);
  });
  it('excludes reminders, unconfirmed, archived, self and dangling edges without modifying records', () => {
    const source: LinkGraph = { ...graph, links: [edge('a', 'b'),
      edge('a', 'c', { relationType: 'review_later' }), edge('a', 'd', { confirmedByUser: false }),
      edge('b', 'd', { archivedAt: '2026-11-10' }), edge('a', 'a'), edge('a', 'missing'),
      edge('a', 'c', { toType: 'todo' })] };
    const snapshot = JSON.stringify(source);
    const result = projectNoteGraph(source, filters);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes).toHaveLength(5);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('merges both directions and different relationship types into one line with unique-neighbor degree', () => {
    const result = projectNoteGraph({ ...graph, links: [edge('a', 'b'), edge('b', 'a', { relationType: 'contrast' })] }, filters);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].relations).toHaveLength(2);
    expect(result.nodes.find(node => node.id === 'a')?.degree).toBe(1);
  });

  it('limits local graphs to one or two hops and preserves an isolated center', () => {
    expect(projectNoteGraph(graph, { ...filters, center: 'a' }).nodes.map(node => node.id)).toEqual(['a', 'b']);
    expect(projectNoteGraph(graph, { ...filters, center: 'a', depth: 2 }).nodes.map(node => node.id)).toEqual(['a', 'b', 'c']);
    expect(projectNoteGraph(graph, { ...filters, center: 'orphan', showOrphans: false }).nodes.map(node => node.id)).toEqual(['orphan']);
    expect(projectNoteGraph(graph, { ...filters, center: 'deleted' }).nodes).toEqual([]);
  });

  it('recomputes edges and degrees after title and relationship filtering', () => {
    const result = projectNoteGraph(graph, { ...filters, query: 'NOTE B' });
    expect(result.nodes.map(node => node.id)).toEqual(['b']);
    expect(result.nodes[0].degree).toBe(0);
    expect(result.edges).toEqual([]);
    expect(projectNoteGraph(graph, { ...filters, relation: 'contrast', showOrphans: false }).nodes).toEqual([]);
    expect(projectNoteGraph(graph, { ...filters, showOrphans: false }).nodes).toHaveLength(4);
  });
});

describe('settled graph layout', () => {
  it('is stable and does not mutate the projected graph', () => {
    const projected = projectNoteGraph(graph, filters);
    const snapshot = JSON.stringify(projected);
    expect(layoutNoteGraph(projected)).toEqual(layoutNoteGraph(projected));
    expect(JSON.stringify(projected)).toBe(snapshot);
  });

  it('keeps a large disconnected library within the initial viewport', () => {
    const large = { nodes: Array.from({ length: 1000 }, (_, id) => ({ id: String(id), label: String(id), type: 'note' as const, degree: 0 })), edges: [] };
    const positions = layoutNoteGraph(large);
    expect(positions.size).toBe(1000);
    for (const p of positions.values()) {
      expect(p.x).toBeGreaterThanOrEqual(60); expect(p.x).toBeLessThanOrEqual(840);
      expect(p.y).toBeGreaterThanOrEqual(40); expect(p.y).toBeLessThanOrEqual(480);
    }
    expect(layoutNoteGraph({ nodes: [], edges: [] }).size).toBe(0);
  });

  it('fits wide and narrow panels without scaling down the SVG labels', () => {
    const projected = projectNoteGraph(graph, filters);
    for (const [width, height] of [[1100, 320], [300, 260]]) {
      const points = [...layoutNoteGraph(projected, width, height).values()];
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(80);
        expect(point.x).toBeLessThanOrEqual(width - 80);
        expect(point.y).toBeGreaterThanOrEqual(50);
        expect(point.y).toBeLessThanOrEqual(height - 50);
      }
    }
  });
});
