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

/** 带展示名的图节点 */
export interface LabeledGraphNode extends GraphNode {
  label: string;
}

export interface LinkGraph {
  nodes: LabeledGraphNode[];
  links: KnowledgeLink[];
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
  /** 当前选中的节点，用于高亮邻居 */
  selected?: { type: LinkEntityType; id: string };
  /** 关系类型筛选。空数组表示不筛 */
  relationFilter: LinkRelationType[];
  includeArchived: boolean;
  loading: boolean;
  /** AI 正在检索关联建议 */
  suggesting: boolean;
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
  suggestForNote: (noteId: string) => Promise<{ suggested: number; created: KnowledgeLink[] }>;
  archive: (id: string) => Promise<void>;
  undoArchive: () => Promise<void>;
}

const EMPTY_GRAPH: LinkGraph = { nodes: [], links: [] };

/** id 兜底显示：全长 uuid 铺在图上没法看 */
const shortId = (id: string): string => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

const TYPE_LABELS: Record<LinkEntityType, string> = {
  note: '笔记',
  chunk: '片段',
  concept: '概念',
  todo: '任务',
  review_item: '复盘',
};

/**
 * 给节点补标签。
 *
 * 只查 note 和 todo：chunk / concept / review_item 目前没有独立的
 * 展示名来源，用「类型 + 短 id」已经够区分，不值得为此加仓储方法。
 */
const labelNodes = async (nodes: GraphNode[]): Promise<LabeledGraphNode[]> => {
  const noteIds = nodes.filter((node) => node.type === 'note').map((node) => node.id);
  const todoIds = nodes.filter((node) => node.type === 'todo').map((node) => node.id);

  const titles = new Map<string, string>();

  // 整表拉一次再本地匹配，比逐个 findById 发 N 次查询划算（图上节点通常不多）
  if (noteIds.length > 0) {
    const notes = await repositories.note.listAll();
    notes.forEach((note) => titles.set(`note:${note.id}`, note.title));
  }
  if (todoIds.length > 0) {
    const todos = await repositories.todo.listAll();
    todos.forEach((todo) => titles.set(`todo:${todo.id}`, todo.title));
  }

  return nodes.map((node) => ({
    ...node,
    label:
      titles.get(`${node.type}:${node.id}`) ??
      `${TYPE_LABELS[node.type]} ${shortId(node.id)}`,
  }));
};

/**
 * 拉可选实体清单。
 *
 * 和 labelNodes 一样整表取：连接页打开时取一次就够，用户不会在这个页面
 * 里新建笔记。任务只留未完成的 —— 给已完成的任务挂前置关系没有意义。
 */
const loadEntityOptions = async (): Promise<EntityOption[]> => {
  const [notes, todos] = await Promise.all([
    repositories.note.listAll(),
    repositories.todo.listAll(),
  ]);

  return [
    ...notes.map((note) => ({ type: 'note' as const, id: note.id, label: note.title })),
    ...todos
      .filter((todo) => todo.status !== 'completed')
      .map((todo) => ({ type: 'todo' as const, id: todo.id, label: todo.title })),
  ];
};

export const useKnowledgeLinkStore = create<KnowledgeLinkState>((set, get) => ({
  graph: EMPTY_GRAPH,
  suggesting: false,
  relationFilter: [],
  includeArchived: false,
  loading: false,
  entityOptions: [],

  refresh: async () => {
    const { relationFilter, includeArchived } = get();
    set({ loading: true, error: undefined });
    try {
      const graph = await useCases.queryKnowledgeLinks.executeAsGraph({
        relationTypes: relationFilter.length > 0 ? relationFilter : undefined,
        includeArchived,
      });
      set({
        graph: { nodes: await labelNodes(graph.nodes), links: graph.links },
        entityOptions: await loadEntityOptions(),
        loading: false,
      });
    } catch (error) {
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
    set({ error: undefined, suggesting: true });
    try {
      const result = await useCases.suggestKnowledgeLinks.execute(noteId);
      // 确认写入后图会变，重取一次；用户拒绝或没有建议时保持现状
      if (result.created.length > 0) await get().refresh();
      return result;
    } catch (error) {
      set({ error: describeError(error) });
      return { suggested: 0, created: [] };
    } finally {
      set({ suggesting: false });
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
}));

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
