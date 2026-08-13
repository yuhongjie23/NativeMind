/**
 * 领域对象类型
 *
 * 实体定义的唯一来源在 application/ports（用例和仓储都依赖它），
 * 这里只做转发，让 UI 能用 `@shared-types/domain` 这一个入口引类型，
 * 不必顺着 application 的内部路径摸。两处各写一份必然会漂移。
 */
export type {
  CompanionInteraction,
  FocusSession,
  KnowledgeLink,
  KnowledgeLinkQuery,
  LinkCreatedBy,
  LinkEntityType,
  LinkRelationType,
  Note,
  NoteSourceType,
  Priority,
  ReviewLog,
  SearchHit,
  SocraticExchange,
  SocraticSession,
  Todo,
  TodoDraft,
  TodoStatus,
} from '@application/ports';

/**
 * 图结构类型同样从用例层转发。
 *
 * 这里原先自己定义了一套 GraphNode / GraphEdge 占位类型（label + weight），
 * 现在 query-links 用例已经产出真实结构，保留两份必然漂移，所以改为转发。
 */
export type { GraphNode, KnowledgeGraph } from '@application/use-cases/knowledge-link/query-links';


/** 笔记索引状态。UI 用它决定显示「索引中」还是「可检索」 */
export type NoteIndexStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'indexing'
  | 'indexed'
  | 'failed'
  | 'stale';



