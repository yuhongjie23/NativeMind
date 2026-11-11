import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';
import type { NoteGraph } from './graph-model';

interface LayoutNode extends SimulationNodeDatum { id: string; x: number; y: number }
export const GRAPH_WIDTH = 900;
export const GRAPH_HEIGHT = 520;

/** Settled, deterministic layout: no perpetual animation while studying. */
export function layoutNoteGraph(graph: NoteGraph, width = GRAPH_WIDTH, height = GRAPH_HEIGHT): Map<string, { x: number; y: number }> {
  if (!graph.nodes.length) return new Map();
  const nodes: LayoutNode[] = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node, index) => ({
    id: node.id, x: Math.cos(index * 2.4) * Math.sqrt(index + 1) * 25,
    y: Math.sin(index * 2.4) * Math.sqrt(index + 1) * 25,
  }));
  const simulation = forceSimulation(nodes).stop()
    .force('charge', forceManyBody().strength(-180))
    .force('collide', forceCollide(23))
    .force('links', forceLink<LayoutNode, { source: string; target: string }>(graph.edges.map(edge => ({ source: edge.source, target: edge.target })))
      .id(node => node.id).distance(95).strength(0.4))
    .force('center', forceCenter(0, 0));
  simulation.tick(130);
  simulation.stop();
  const xs = nodes.map(node => node.x), ys = nodes.map(node => node.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scaleX = Math.min(1.5, Math.max(1, width - 160) / Math.max(1, maxX - minX));
  const scaleY = Math.min(1.5, Math.max(1, height - 100) / Math.max(1, maxY - minY));
  return new Map(nodes.map(node => [node.id, {
    x: width / 2 + (node.x - (minX + maxX) / 2) * scaleX,
    y: height / 2 + (node.y - (minY + maxY) / 2) * scaleY,
  }]));
}
