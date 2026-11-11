import type { KnowledgeLink, LinkRelationType, NoteGraphReference } from '@application/ports';
import type { LinkGraph, LabeledGraphNode } from '../../../stores/knowledge-link-store';
import { needsReadableTitle } from '@domain/note/title-quality';

export interface GraphEdge { id: string; source: string; target: string; relations: KnowledgeLink[]; references?: NoteGraphReference[] }
export interface NoteGraph { nodes: LabeledGraphNode[]; edges: GraphEdge[] }
export interface GraphFilters { query: string; relation?: LinkRelationType; showOrphans: boolean; center?: string; depth: number }
export const GRAPH_RELATIONS: LinkRelationType[] = ['same_concept', 'prerequisite', 'example_of', 'contrast', 'extends'];

/** Projection only. Reminder state is not a knowledge relationship. Never writes links. */
export function projectNoteGraph(graph: LinkGraph, filters: GraphFilters): NoteGraph {
  const query = filters.query.trim().toLowerCase();
  // Local search needs the unfiltered neighborhood to retain the center and real connecting paths.
  // Global search still returns only literal title matches.
  const nodes = graph.nodes.filter(node => node.type === 'note' && !needsReadableTitle(node.label) &&
    (filters.center || node.label.toLowerCase().includes(query)));
  const ids = new Set(nodes.map(node => node.id));
  const pairs = new Map<string, GraphEdge>();
  for (const link of graph.links) {
    if (!link.confirmedByUser || link.archivedAt || link.relationType === 'review_later' ||
        link.fromType !== 'note' || link.toType !== 'note' || link.fromId === link.toId ||
        !ids.has(link.fromId) || !ids.has(link.toId) || (filters.relation && link.relationType !== filters.relation)) continue;
    const [source, target] = [link.fromId, link.toId].sort();
    const id = JSON.stringify([source, target]);
    const existing = pairs.get(id);
    if (existing) existing.relations.push(link);
    else pairs.set(id, { id, source, target, relations: [link] });
  }
  if (!filters.relation) for (const reference of graph.references ?? []) {
    if (reference.fromId === reference.toId || !ids.has(reference.fromId) || !ids.has(reference.toId)) continue;
    const [source, target] = [reference.fromId, reference.toId].sort();
    const id = JSON.stringify([source, target]);
    const edge = pairs.get(id) ?? { id, source, target, relations: [] };
    edge.references = [...(edge.references ?? []), reference];
    pairs.set(id, edge);
  }
  const edges = [...pairs.values()];
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) { neighbors.get(edge.source)!.add(edge.target); neighbors.get(edge.target)!.add(edge.source); }
  let visible = ids;
  if (filters.center) {
    visible = new Set(ids.has(filters.center) ? [filters.center] : []);
    const parents = new Map<string, string>();
    let frontier = [...visible];
    for (let hop = 0; hop < Math.min(2, Math.max(1, filters.depth)); hop++) {
      const next: string[] = [];
      for (const id of frontier) for (const neighbor of neighbors.get(id) ?? []) {
        if (!visible.has(neighbor)) { visible.add(neighbor); parents.set(neighbor, id); next.push(neighbor); }
      }
      frontier = next;
    }
    if (query) {
      const matchesAndPaths = new Set(ids.has(filters.center) ? [filters.center] : []);
      for (const node of nodes) {
        if (!visible.has(node.id) || !node.label.toLowerCase().includes(query)) continue;
        let id: string | undefined = node.id;
        while (id && !matchesAndPaths.has(id)) {
          matchesAndPaths.add(id);
          id = parents.get(id);
        }
      }
      visible = matchesAndPaths;
    }
  }
  const kept = nodes.filter(node => visible.has(node.id) &&
    (filters.showOrphans || filters.center === node.id || neighbors.get(node.id)!.size > 0));
  const keptIds = new Set(kept.map(node => node.id));
  const keptEdges = edges.filter(edge => keptIds.has(edge.source) && keptIds.has(edge.target));
  const degrees = new Map<string, number>();
  for (const edge of keptEdges) for (const id of [edge.source, edge.target]) degrees.set(id, (degrees.get(id) ?? 0) + 1);
  return { nodes: kept.map(node => ({ ...node, degree: degrees.get(node.id) ?? 0 })), edges: keptEdges };
}
