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
  /** 某篇笔记的已确认关联（笔记详情「相关笔记」区块用） */
  relatedNotes: (noteId: string) => Promise<
    Array<{ noteId: string; title: string; relationType: LinkRelationType }>
  >;
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
 * 给节点补标签，并过滤悬空节点。
 *
 * 只查 note 和 todo：chunk / concept / review_item 目前没有独立的
 * 展示名来源，用「类型 + 短 id」已经够区分，不值得为此加仓储方法。
 *
 * 用 findByIds 而不是 listAll：listAll 默认只取前 100 条，笔记一多
 * 图上的节点就落进「笔记 xxxx…」兜底，看不出是哪篇。精确按图上
 * 的节点 id 查，笔记再多标签也对得上。
 *
 * 顺带把「指向已删除笔记」的悬空节点和边过滤掉：删除笔记时虽然会
 * 清理它的链接，但历史残留仍在——图上显示「笔记 xxxx…」既看不出是
 * 哪篇，点击也没有内容，不如直接不显示。
 */
const labelNodes = async (nodes: GraphNode[], links: KnowledgeLink[]): Promise<LinkGraph> => {
  const noteIds = nodes.filter((node) => node.type === 'note').map((node) => node.id);
  const todoIds = nodes.filter((node) => node.type === 'todo').map((node) => node.id);

  const titles = new Map<string, string>();

  if (noteIds.length > 0) {
    // 图节点可能很多：findByIds 默认 limit=100，节点一多后面的就查不到标题。
    // 这里按图上实际数量分页拉，保证每个节点都拿到标题。
    const notes = await repositories.note.findByIds(noteIds, Math.max(noteIds.length, 100));
    notes.forEach((note) => titles.set(`note:${note.id}`, note.title));
  }
  if (todoIds.length > 0) {
    const todos = await repositories.todo.listAll();
    todos.forEach((todo) => titles.set(`todo:${todo.id}`, todo.title));
  }

  // 存在性判定：note/todo 类型查得到标题才算存在；其他类型（chunk 等）视为存在
  const exists = (node: GraphNode): boolean =>
    (node.type === 'note' || node.type === 'todo')
      ? titles.has(`${node.type}:${node.id}`)
      : true;

  // 过滤悬空节点 + 关联它们的边
  const alive = nodes.filter(exists);
  const aliveKeys = new Set(alive.map((node) => `${node.type}:${node.id}`));
  const aliveLinks = links.filter(
    (link) =>
      aliveKeys.has(`${link.fromType}:${link.fromId}`) &&
      aliveKeys.has(`${link.toType}:${link.toId}`)
  );

  return {
    nodes: alive.map((node) => ({
      ...node,
      label:
        titles.get(`${node.type}:${node.id}`) ??
        `${TYPE_LABELS[node.type]} ${shortId(node.id)}`,
    })),
    links: aliveLinks,
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
  linkCounts: {},
  suggesting: false,
  relationFilter: [],
  includeArchived: false,
  loading: false,
  entityOptions: [],

  refresh: async () => {
    const { relationFilter, includeArchived } = get();
    set({ loading: true, error: undefined });
    try {
      const [graph, allConfirmed] = await Promise.all([
        useCases.queryKnowledgeLinks.executeAsGraph({
          relationTypes: relationFilter.length > 0 ? relationFilter : undefined,
          includeArchived,
        }),
        // 全量已确认边（不受筛选影响）算每篇笔记的关联数，笔记列表徽章用
        useCases.queryKnowledgeLinks.execute({ onlyConfirmed: true, includeArchived: false }),
      ]);
      const counts: Record<string, number> = {};
      for (const link of allConfirmed) {
        if (link.fromType === 'note') counts[link.fromId] = (counts[link.fromId] ?? 0) + 1;
        if (link.toType === 'note') counts[link.toId] = (counts[link.toId] ?? 0) + 1;
      }
      set({
        graph: await labelNodes(graph.nodes, graph.links),
        linkCounts: counts,
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

      const result: Array<{ noteId: string; title: string; relationType: LinkRelationType }> = [];
      for (const link of confirmed) {
        const otherId = link.fromId === noteId ? link.toId : link.fromId;
        const otherType = link.fromId === noteId ? link.toType : link.fromType;
        if (otherType !== 'note') continue;
        const title = titleById.get(otherId);
        if (!title) continue; // 对端笔记已删：跳过
        result.push({ noteId: otherId, title, relationType: link.relationType });
      }
      return result;
    } catch {
      return [];
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
