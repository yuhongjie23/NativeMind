/**
 * 知识链接 store
 *
 * 两件事值得单独说明：
 *
 * 1. 节点标签。用例层只给 `{type, id, degree}`，因为它不该知道「笔记标题」
 *    该怎么显示。这里按类型去对应仓储取标题，取不到就退化成短 id ——
 *    关系指向的实体可能已被删除，不能因此让整张图渲染不出来。
 *
 * 2. 归档后保留一份 lastArchived，让页面能给出「撤销」。软删除的意义就在
 *    于可撤销，如果 UI 不给入口，那和硬删没区别。
 */
import { create } from 'zustand';
import type { KnowledgeLink, LinkEntityType, LinkRelationType } from '@shared-types/domain';
import type { GraphNode } from '@application/use-cases/knowledge-link/query-links';
import { describeError, repositories, useCases } from './runtime';
import { useToastStore } from './toast-store';
import type { NoteGraphReference } from '@application/ports';

/** 带展示名的图节点 */
export interface LabeledGraphNode extends GraphNode {
  label: string;
}

export interface LinkGraph {
  nodes: LabeledGraphNode[];
  links: KnowledgeLink[];
  truncated?: boolean;
  references?: NoteGraphReference[];
}

/**
 * 可选实体，供建立关系时挑选。
 *
 * 只收 note 和 todo：这两类有用户认得出的名字。chunk / concept /
 * review_item 目前没有独立展示名，让用户从一堆 id 里挑没有意义。
 */
export interface EntityOption {
  type: LinkEntityType;
  id: string;
  label: string;
}


interface KnowledgeLinkState {
  graph: LinkGraph;
  /** noteId → 已确认、未归档的关联边数。笔记列表/搜索结果的链接徽章用 */
  linkCounts: Record<string, number>;
  /** 当前选中的节点，用于高亮邻居 */
  selected?: { type: LinkEntityType; id: string };
  /** 关系类型筛选。空数组表示不筛 */
  relationFilter: LinkRelationType[];
  includeArchived: boolean;
  loading: boolean;
  /** AI 正在检索关联建议 */
  suggesting: boolean;
  canCancelSuggestions: boolean;
  cancelSuggestions: () => void;
  error?: string;
  /** 最近一次归档，供「撤销」用 */
  lastArchived?: KnowledgeLink;
  /** 建立关系时可选的实体（笔记 + 任务） */
  entityOptions: EntityOption[];

  refresh: () => Promise<void>;

  select: (node?: { type: LinkEntityType; id: string }) => void;
  toggleRelation: (relation: LinkRelationType) => Promise<void>;
  setIncludeArchived: (include: boolean) => Promise<void>;
  createLink: (input: {
    fromType: LinkEntityType;
    fromId: string;
    toType: LinkEntityType;
    toId: string;
    relationType: LinkRelationType;
    reason?: string;
  }) => Promise<void>;
  /** 为新笔记检索相关旧笔记并建议建链（确认弹窗由 ConfirmationService 触发） */
  suggestForNote: (noteId: string) => Promise<{ suggested: number; created: KnowledgeLink[]; cancelled?: boolean; skipped?: boolean }>;
  archive: (id: string) => Promise<void>;
  undoArchive: () => Promise<void>;
  /** 某篇笔记的已确认关联（笔记详情「相关笔记」区块用） */
  relatedNotes: (noteId: string) => Promise<
    Array<{ id: string; noteId: string; title: string; relationType: LinkRelationType }>
  >;
}

const EMPTY_GRAPH: LinkGraph = { nodes: [], links: [] };

const TYPE_LABELS: Record<LinkEntityType, string> = {
  note: '笔记',
  chunk: '片段',
  concept: '概念',
  todo: '任务',
  review_item: '复盘',
};

/** Keep the graph note-only and include saved notes without semantic links. */
const labelNodes = (notes: Array<{ id: string; title: string }>, links: KnowledgeLink[]): LinkGraph => {
  const visible = notes.slice(0, 1000);
  const ids = new Set(visible.map(note => note.id));
  return {
    nodes: visible.map(note => ({ type: 'note', id: note.id, label: note.title, degree: 0 })),
    links: links.slice(0, 10000).filter(link => link.confirmedByUser && link.relationType !== 'review_later'
      && link.fromType === 'note' && link.toType === 'note' && ids.has(link.fromId) && ids.has(link.toId)),
    truncated: notes.length > 1000 || links.length > 10000,
  };
};

/**
 * 拉可选实体清单。
 *
 * 和 labelNodes 一样整表取：连接页打开时取一次就够，用户不会在这个页面
 * 里新建笔记。任务只留未完成的 —— 给已完成的任务挂前置关系没有意义。
 */
const loadEntityOptions = async (): Promise<EntityOption[]> => {
  const [notes, todos] = await Promise.all([
    repositories.note.listGraphSummaries(1000),
    repositories.todo.listAll(),
  ]);

  return [
    ...notes.map((note) => ({ type: 'note' as const, id: note.id, label: note.title })),
    ...todos
      .filter((todo) => todo.status !== 'completed')
      .map((todo) => ({ type: 'todo' as const, id: todo.id, label: todo.title })),
  ];
};

export const useKnowledgeLinkStore = create<KnowledgeLinkState>((set, get) => {
  let refreshSequence = 0;
  const requests = new Map<string, { controller: AbortController; committing: boolean }>();
  const syncRequests = () => set({
    suggesting: requests.size > 0,
    canCancelSuggestions: [...requests.values()].some(request => !request.committing),
  });
  return ({
  graph: EMPTY_GRAPH,
  linkCounts: {},
  suggesting: false,
  canCancelSuggestions: false,
  cancelSuggestions: () => {
    for (const [id, request] of requests) {
      if (request.committing) continue;
      requests.delete(id);
      request.controller.abort();
    }
    syncRequests();
  },
  relationFilter: [],
  includeArchived: false,
  loading: false,
  entityOptions: [],

  refresh: async () => {
    const sequence = ++refreshSequence;
    const { relationFilter, includeArchived } = get();
    set({ loading: true, error: undefined });
    try {
      const [notes, allConfirmed] = await Promise.all([
        repositories.note.listGraphSummaries(1001),
        useCases.queryKnowledgeLinks.execute({ onlyConfirmed: true, includeArchived, limit: 10001 }),
      ]);
      const counts: Record<string, number> = {};
      for (const link of allConfirmed) {
        if (link.archivedAt) continue;
        if (link.fromType === 'note') counts[link.fromId] = (counts[link.fromId] ?? 0) + 1;
        if (link.toType === 'note') counts[link.toId] = (counts[link.toId] ?? 0) + 1;
      }
      const entityOptions = await loadEntityOptions();
      const references = await repositories.note.listGraphReferences(notes.slice(0, 1000).map(note => note.id), 10001);
      if (sequence !== refreshSequence) return;
      const graph = labelNodes(notes, allConfirmed);
      graph.references = references.slice(0, Math.max(0, 10000 - graph.links.length));
      graph.truncated ||= graph.links.length + references.length > 10000;
      if (relationFilter.length) graph.links = graph.links.filter(link => relationFilter.includes(link.relationType));
      set({
        graph,
        linkCounts: counts,
        entityOptions,
        loading: false,
      });
    } catch (error) {
      if (sequence !== refreshSequence) return;
      set({ loading: false, error: describeError(error) });
    }
  },


  select: (node) => {
    // 再点一次同一个节点取消选中，省一个「清除选择」按钮
    const current = get().selected;
    const same = current && node && current.type === node.type && current.id === node.id;
    set({ selected: same ? undefined : node });
  },

  toggleRelation: async (relation) => {
    const current = get().relationFilter;
    const next = current.includes(relation)
      ? current.filter((item) => item !== relation)
      : [...current, relation];
    set({ relationFilter: next });
    await get().refresh();
  },

  setIncludeArchived: async (include) => {
    set({ includeArchived: include });
    await get().refresh();
  },

  createLink: async (input) => {
    set({ error: undefined });
    try {
      await useCases.createKnowledgeLink.execute(input);
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },
  suggestForNote: async (noteId) => {
    if (requests.has(noteId)) return { suggested: 0, created: [], skipped: true };
    const request = { controller: new AbortController(), committing: false };
    requests.set(noteId, request);
    set({ error: undefined });
    syncRequests();
    try {
      const result = await useCases.suggestKnowledgeLinks.execute(noteId, {
        signal: request.controller.signal,
        onCommit: () => { request.committing = true; syncRequests(); },
      });
      if (request.controller.signal.aborted) return { suggested: 0, created: [], cancelled: true };
      if (result.created.length > 0) await get().refresh();
      return result;
    } catch (error) {
      if (request.controller.signal.aborted) return { suggested: 0, created: [], cancelled: true };
      set({ error: describeError(error) });
      useToastStore.getState().show(describeError(error), 'info');
      return { suggested: 0, created: [], skipped: true };
    } finally {
      if (requests.get(noteId) === request) requests.delete(noteId);
      syncRequests();
    }
  },

  archive: async (id) => {
    set({ error: undefined });
    try {
      const archived = await useCases.archiveKnowledgeLink.execute(id);
      set({ lastArchived: archived });
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  undoArchive: async () => {
    const target = get().lastArchived;
    if (!target) return;
    set({ error: undefined });
    try {
      await useCases.archiveKnowledgeLink.restore(target.id);
      set({ lastArchived: undefined });
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  /** 某篇笔记的已确认关联：查邻居边 → 解析对端 note 标题 + 关系标签 */
  relatedNotes: async (noteId) => {
    try {
      const links = await useCases.queryKnowledgeLinks.findNeighbors({
        type: 'note',
        id: noteId,
      });
      // 只取已确认、未归档、对端是笔记的关系
      const confirmed = links.filter(
        (link) => link.confirmedByUser && !link.archivedAt,
      );
      if (confirmed.length === 0) return [];

      const peerIds = new Set<string>();
      for (const link of confirmed) {
        const otherType = link.fromId === noteId ? link.toType : link.fromType;
        const otherId = link.fromId === noteId ? link.toId : link.fromId;
        if (otherType === 'note') peerIds.add(otherId);
      }
      if (peerIds.size === 0) return [];

      const notes = await repositories.note.listAll();
      const titleById = new Map(notes.map((note) => [note.id, note.title]));

      const result: Array<{
        id: string;
        noteId: string;
        title: string;
        relationType: LinkRelationType;
      }> = [];
      for (const link of confirmed) {
        const otherId = link.fromId === noteId ? link.toId : link.fromId;
        const otherType = link.fromId === noteId ? link.toType : link.fromType;
        if (otherType !== 'note') continue;
        const title = titleById.get(otherId);
        if (!title) continue; // 对端笔记已删：跳过
        result.push({ id: link.id, noteId: otherId, title, relationType: link.relationType });
      }
      return result;
    } catch {
      return [];
    }
  },
});
});

/** 关系类型的中文名，UI 多处要用 */
export const RELATION_LABELS: Record<LinkRelationType, string> = {
  same_concept: '同一概念',
  prerequisite: '前置知识',
  example_of: '例子',
  contrast: '对比',
  extends: '延伸',
  review_later: '需要复习',
};

export const ENTITY_TYPE_LABELS = TYPE_LABELS;
