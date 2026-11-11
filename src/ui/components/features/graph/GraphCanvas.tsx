import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../../../i18n';
import type { LabeledGraphNode } from '../../../stores/knowledge-link-store';
import type { NoteGraph } from './graph-model';
import { GRAPH_HEIGHT as HEIGHT, GRAPH_WIDTH as WIDTH, layoutNoteGraph } from './graph-layout';
import { INITIAL_GRAPH_VIEW, useKnowledgeGraphViewStore } from '../../../stores/knowledge-graph-view-store';

const initialView = INITIAL_GRAPH_VIEW;
export function GraphCanvas({ graph, selected, onSelect, onOpen }: {
  graph: NoteGraph; selected?: string; onSelect: (id: string) => void; onOpen: (node: LabeledGraphNode) => void;
}) {
  const t = useT();
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: WIDTH, height: HEIGHT });
  const positions = useMemo(() => layoutNoteGraph(graph, size.width, size.height), [graph, size]);
  const view = useKnowledgeGraphViewStore(state => state.viewport);
  const setView = useKnowledgeGraphViewStore(state => state.setViewport);
  const [hover, setHover] = useState<string>();
  const [overrides, setOverrides] = useState(new Map<string, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; node?: string; moved: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setOverrides(new Map()); }, [positions]);
  const active = hover ?? selected;
  const neighbors = useMemo(() => new Set(graph.edges.flatMap(edge =>
    edge.source === active ? [edge.target] : edge.target === active ? [edge.source] : [])), [graph.edges, active]);
  const zoom = (factor: number) => setView(previous => {
    const k = Math.max(0.4, Math.min(4, previous.k * factor));
    const ratio = k / previous.k;
    return { k, x: 0.5 - (0.5 - previous.x) * ratio, y: 0.5 - (0.5 - previous.y) * ratio };
  });
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setView(previous => {
        const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
        const matrix = svg.getScreenCTM(); if (!matrix) return previous;
        const anchor = point.matrixTransform(matrix.inverse());
        const k = Math.max(0.4, Math.min(4, previous.k * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002)));
        const ratio = k / previous.k;
        const x = anchor.x / size.width, y = anchor.y / size.height;
        return { k, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio };
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [size.width, size.height, setView]);
  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const node = (event.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? undefined;
    drag.current = { x: event.clientX, y: event.clientY, node, moved: false };
    suppressClick.current = false;
    ((event.target as Element).closest('[data-node]') ?? event.currentTarget).setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const state = drag.current; if (!state) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    state.moved = true; suppressClick.current = true;
    const scale = ref.current?.getScreenCTM()?.a ?? 1;
    if (state.node) {
      const id = state.node;
      setOverrides(previous => {
        const position = previous.get(id) ?? positions.get(id); if (!position) return previous;
        return new Map(previous).set(id, { x: position.x + dx / scale / view.k, y: position.y + dy / scale / view.k });
      });
    } else setView(previous => ({ ...previous, x: previous.x + dx / scale / size.width, y: previous.y + dy / scale / size.height }));
    state.x = event.clientX; state.y = event.clientY;
  };
  const point = (id: string) => overrides.get(id) ?? positions.get(id)!;
  return <div className="note-graph__viewport">
    <div className="note-graph__zoom">
      <button type="button" className="cozy-btn-secondary" aria-label={t('放大图谱')} onClick={() => zoom(1.25)}>＋</button>
      <span>{Math.round(view.k * 100)}%</span>
      <button type="button" className="cozy-btn-secondary" aria-label={t('缩小图谱')} onClick={() => zoom(0.8)}>−</button>
      <button type="button" className="cozy-btn-secondary" onClick={() => { setView(initialView); setOverrides(new Map()); }}>{t('重置视图')}</button>
    </div>
    <svg ref={ref} viewBox={`0 0 ${size.width} ${size.height}`} className="note-graph__canvas" role="group" aria-label={t('可交互的笔记关系图')}
      tabIndex={0} onPointerDown={begin} onPointerMove={move} onPointerUp={() => { drag.current = undefined; }}
      onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (['+', '=', '-', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoom(1.25);
        if (event.key === '-') zoom(0.8);
        if (event.key === 'Home') setView(initialView);
        if (event.key.startsWith('Arrow')) setView(previous => ({ ...previous,
          x: previous.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0) / size.width,
          y: previous.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) / size.height }));
      }}>
      <g transform={`translate(${view.x * size.width} ${view.y * size.height}) scale(${view.k})`}>
        {graph.edges.map(edge => {
          const from = point(edge.source), to = point(edge.target);
          const highlighted = edge.source === active || edge.target === active;
          return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="note-graph__edge"
            data-highlight={highlighted} opacity={active && !highlighted ? 0.15 : 0.65} />;
        })}
        {graph.nodes.map(node => {
          const p = point(node.id), highlighted = node.id === active || neighbors.has(node.id);
          const radius = 6 + Math.min(6, Math.sqrt(node.degree) * 1.5);
          return <g key={node.id} data-node={node.id} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0}
            aria-label={t('{0}，{1} 个相邻笔记', node.label, node.degree)} aria-pressed={selected === node.id}
            className="note-graph__node" data-selected={selected === node.id} data-orphan={node.degree === 0}
            opacity={active && !highlighted ? 0.3 : 1} onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover(undefined)}
            onFocus={() => setHover(node.id)} onBlur={() => setHover(undefined)}
            onClick={() => { if (!suppressClick.current) onSelect(node.id); }}
            onDoubleClick={() => { if (!suppressClick.current) onOpen(node); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } }}>
            <title>{node.label}</title><circle r={radius} />
            {(graph.nodes.length <= 80 || highlighted || view.k > 1.5) && <text y={radius + 16} textAnchor="middle">
              {node.label.length > 22 ? `${node.label.slice(0, 22)}…` : node.label}
            </text>}
          </g>;
        })}
      </g>
    </svg>
  </div>;
}
