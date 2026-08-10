/**
 * QueryKnowledgeLinksUseCase
 *
 * 纯读取，不确认、不发事件。连接页拉图数据和侧栏列表都走这里。
 *
 * 顺带把「边」组装成图需要的节点集合：UI 只拿到边列表的话，
 * 还得自己去重端点、算度数，那属于展示逻辑里重复的一段，放这里更省事。
 */
import type {
  KnowledgeLink,
  KnowledgeLinkQuery,
  KnowledgeLinkRepository,
  LinkEntityType,
} from '../../ports';
import type { UUID } from '@shared-types/common';

/** 图节点。label 由 UI 侧按类型补全（笔记标题、任务名等），这里只给 id */
export interface GraphNode {
  type: LinkEntityType;
  id: UUID;
  /** 连接数，用来决定节点大小 */
  degree: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  links: KnowledgeLink[];
}

/** 端点的唯一键。不同类型可能撞 id，必须带上类型 */
const nodeKey = (type: LinkEntityType, id: UUID): string => `${type}:${id}`;

export const buildGraph = (links: KnowledgeLink[]): KnowledgeGraph => {
  const nodes = new Map<string, GraphNode>();

  const touch = (type: LinkEntityType, id: UUID): void => {
    const key = nodeKey(type, id);
    const existing = nodes.get(key);
    if (existing) {
      existing.degree += 1;
      return;
    }
    nodes.set(key, { type, id, degree: 1 });
  };

  for (const link of links) {
    touch(link.fromType, link.fromId);
    touch(link.toType, link.toId);
  }

  // 度数高的排前面，UI 想只渲染前 N 个时可以直接截断
  return {
    nodes: [...nodes.values()].sort((a, b) => b.degree - a.degree),
    links,
  };
};

export class QueryKnowledgeLinksUseCase {
  constructor(private readonly linkRepo: KnowledgeLinkRepository) {}

  /** 按条件取边 */
  async execute(query: KnowledgeLinkQuery = {}): Promise<KnowledgeLink[]> {
    return this.linkRepo.query(query);
  }

  /** 取边并组装成图 */
  async executeAsGraph(query: KnowledgeLinkQuery = {}): Promise<KnowledgeGraph> {
    const links = await this.linkRepo.query(query);
    return buildGraph(links);
  }

  /** 某个实体的直接邻居（一跳） */
  async findNeighbors(entity: { type: LinkEntityType; id: UUID }): Promise<KnowledgeLink[]> {
    return this.linkRepo.query({ entity });
  }
}
