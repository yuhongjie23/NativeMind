import { create } from 'zustand';
import type { LinkRelationType } from '@application/ports';

/** Translation is relative to canvas size, so reopening at a different size keeps the view usable. */
export interface GraphViewport { x: number; y: number; k: number }
export const INITIAL_GRAPH_VIEW: GraphViewport = { x: 0, y: 0, k: 1 };
interface GraphPreferences {
  query: string;
  relation?: LinkRelationType;
  showOrphans: boolean;
  selected?: string;
  local: boolean;
  depth: number;
}
const defaults: GraphPreferences = { query: '', showOrphans: true, local: false, depth: 1 };

/** Window/session-only UI state. No note content, database writes, or cross-account persistence. */
export const useKnowledgeGraphViewStore = create<GraphPreferences & {
  viewport: GraphViewport;
  selectionUnavailable: boolean;
  setFilters: (patch: Partial<Pick<GraphPreferences, 'query' | 'relation' | 'showOrphans' | 'local' | 'depth'>>) => void;
  select: (id?: string) => void;
  clearFilters: () => void;
  reconcileSelection: (availableIds: Set<string>) => void;
  setViewport: (update: GraphViewport | ((previous: GraphViewport) => GraphViewport)) => void;
}>((set, get) => ({
  ...defaults,
  viewport: INITIAL_GRAPH_VIEW,
  selectionUnavailable: false,
  setFilters: patch => set({ ...patch, viewport: INITIAL_GRAPH_VIEW }),
  select: selected => set(state => ({ selected, selectionUnavailable: false,
    local: selected ? state.local : false,
    viewport: state.local ? INITIAL_GRAPH_VIEW : state.viewport })),
  clearFilters: () => set({ ...defaults, relation: undefined, viewport: INITIAL_GRAPH_VIEW, selectionUnavailable: false }),
  reconcileSelection: availableIds => {
    const selected = get().selected;
    if (selected && !availableIds.has(selected)) set({ selected: undefined, local: false,
      viewport: INITIAL_GRAPH_VIEW, selectionUnavailable: true });
  },
  setViewport: update => set(state => ({ viewport: typeof update === 'function' ? update(state.viewport) : update })),
}));
