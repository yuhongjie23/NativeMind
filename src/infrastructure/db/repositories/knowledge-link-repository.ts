/**
 * KnowledgeLinkRepository 的 SQLite 实现
 *
 * 表在 001_init.sql 就已建好，004 补了 updated_at / archived_at 两列
 * 以及 (from,to,relation) 上的唯一索引。
 *
 * 两点约定：
 * - 删除一律走归档（archived_at 置时间戳）。AI 建议被否掉后仍要留痕，
 *   否则同一条关系会被反复建议、反复被否。
 * - save 用 UPSERT。AI 每次检索都可能产出同样的边，靠唯一索引 + UPSERT
 *   做幂等，而不是先查再插（那样并发下仍会撞索引）。
 */
import type {
  KnowledgeLink,
  KnowledgeLinkQuery,
  KnowledgeLinkRepository,
  LinkCreatedBy,
  LinkEntityType,
  LinkRelationType,
} from '@application/ports';
import type { ISO8601DateTime, UUID } from '@shared-types/common';
import {
  fromBoolColumn,
  optionalNumber,
  optionalText,
  readNumber,
  readText,
  toBoolColumn,
  type Database,
  type SqlParam,
  type SqlRow,
} from '../database';

const COLUMNS = `id, from_type, from_id, to_type, to_id, relation_type, reason,
       confidence, created_by, confirmed_by_user, created_at, updated_at, archived_at`;

const UPSERT = `
INSERT INTO knowledge_links (
  id, from_type, from_id, to_type, to_id, relation_type, reason,
  confidence, created_by, confirmed_by_user, created_at, updated_at, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(from_type, from_id, to_type, to_id, relation_type) DO UPDATE SET
  reason = excluded.reason,
  confidence = excluded.confidence,
  -- 用户确认过就不该被后来的 AI 建议改回未确认
  confirmed_by_user = MAX(knowledge_links.confirmed_by_user, excluded.confirmed_by_user),
  updated_at = excluded.updated_at,
  -- 已归档的边不能被后来的 save（哪怕 archivedAt 没传）悄悄复活；
  -- 撤销归档要走显式的恢复操作
  archived_at = CASE
    WHEN knowledge_links.archived_at IS NOT NULL THEN knowledge_links.archived_at
    ELSE excluded.archived_at
  END`;

const toLink = (row: SqlRow): KnowledgeLink => ({
  id: String(row.id),
  fromType: String(row.from_type) as LinkEntityType,
  fromId: String(row.from_id),
  toType: String(row.to_type) as LinkEntityType,
  toId: String(row.to_id),
  relationType: String(row.relation_type) as LinkRelationType,
  reason: readText(row.reason),
  confidence: readNumber(row.confidence),
  createdBy: String(row.created_by) as LinkCreatedBy,
  confirmedByUser: fromBoolColumn(row.confirmed_by_user),
  createdAt: String(row.created_at),
  // 004 之前的历史行迁移时已回填，理论上不会为空；兜底避免出现 "undefined"
  updatedAt: readText(row.updated_at) ?? String(row.created_at),
  archivedAt: readText(row.archived_at),
});

export class SqliteKnowledgeLinkRepository implements KnowledgeLinkRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UUID): Promise<KnowledgeLink | null> {
    const row = await this.db.selectOne(`SELECT ${COLUMNS} FROM knowledge_links WHERE id = ?`, [id]);
    return row ? toLink(row) : null;
  }

  async query(query: KnowledgeLinkQuery): Promise<KnowledgeLink[]> {
    const where: string[] = [];
    const params: SqlParam[] = [];

    if (!query.includeArchived) where.push('archived_at IS NULL');
    if (query.onlyConfirmed) where.push('confirmed_by_user = 1');

    // 一个实体既可能是起点也可能是终点，两侧都要查
    if (query.entity) {
      where.push('((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?))');
      params.push(query.entity.type, query.entity.id, query.entity.type, query.entity.id);
    }

    if (query.relationTypes?.length) {
      where.push(`relation_type IN (${query.relationTypes.map(() => '?').join(', ')})`);
      params.push(...query.relationTypes);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // 已确认的排前面，其次按置信度：用户先看到最可信的
    const sql = `SELECT ${COLUMNS} FROM knowledge_links ${clause}
                 ORDER BY confirmed_by_user DESC, confidence DESC, created_at DESC
                 LIMIT ?`;
    params.push(query.limit ?? 200);

    const rows = await this.db.select(sql, params);
    return rows.map(toLink);
  }

  async findEdge(edge: {
    fromType: LinkEntityType;
    fromId: UUID;
    toType: LinkEntityType;
    toId: UUID;
    relationType: LinkRelationType;
  }): Promise<KnowledgeLink | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM knowledge_links
       WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND relation_type = ?`,
      [edge.fromType, edge.fromId, edge.toType, edge.toId, edge.relationType]
    );
    return row ? toLink(row) : null;
  }

  async save(link: KnowledgeLink): Promise<void> {
    const params: SqlParam[] = [
      link.id,
      link.fromType,
      link.fromId,
      link.toType,
      link.toId,
      link.relationType,
      optionalText(link.reason),
      optionalNumber(link.confidence),
      link.createdBy,
      toBoolColumn(link.confirmedByUser),
      link.createdAt,
      link.updatedAt,
      optionalText(link.archivedAt),
    ];
    await this.db.execute(UPSERT, params);
  }

  async archive(id: UUID, archivedAt: ISO8601DateTime): Promise<void> {
    await this.db.execute(
      'UPDATE knowledge_links SET archived_at = ?, updated_at = ? WHERE id = ?',
      [archivedAt, archivedAt, id]
    );
  }

  async restore(id: UUID, updatedAt: ISO8601DateTime): Promise<void> {
    await this.db.execute(
      'UPDATE knowledge_links SET archived_at = NULL, updated_at = ? WHERE id = ?',
      [updatedAt, id]
    );
  }

  /** UI store 统一用 listAll，这里保持与其他仓储一致的叫法 */
  listAll(limit = 200): Promise<KnowledgeLink[]> {
    return this.query({ limit });
  }
}
