/**
 * CompanionInteractionRepository 的 SQLite 实现
 *
 * findLastQuestion / countTodayQuestions 服务于 InteractionPolicy 的频控：
 * 宠物一天能问几次、离上次多久，都靠这两个查询算（打扰率是核心指标）。
 */
import type { CompanionInteraction, CompanionInteractionRepository } from '@application/ports';
import type { UUID } from '@shared-types/common';
import {
  fromBoolColumn,
  optionalText,
  readText,
  toBoolColumn,
  type Database,
  type SqlParam,
  type SqlRow,
} from '../database';

const COLUMNS = `id, companion_id, scene_type, trigger_event, interaction_type,
       content, user_response, animation_name, requires_response,
       conversation_id, reply_to_id, turn_index, initiator, status, role, created_at`;

const toInteraction = (row: SqlRow): CompanionInteraction => ({
  id: String(row.id),
  companionId: String(row.companion_id),
  sceneType: String(row.scene_type),
  triggerEvent: readText(row.trigger_event),
  interactionType: String(row.interaction_type) as CompanionInteraction['interactionType'],
  content: readText(row.content),
  userResponse: readText(row.user_response),
  animationName: readText(row.animation_name),
  requiresResponse: fromBoolColumn(row.requires_response),
  conversationId: readText(row.conversation_id) || undefined,
  replyToId: readText(row.reply_to_id) || undefined,
  turnIndex: row.turn_index === null || row.turn_index === undefined ? undefined : Number(row.turn_index),
  initiator: (readText(row.initiator) || undefined) as CompanionInteraction['initiator'],
  status: (readText(row.status) || undefined) as CompanionInteraction['status'],
  role: (readText(row.role) || 'pet') as CompanionInteraction['role'],
  createdAt: String(row.created_at),
});

export class SqliteCompanionRepository implements CompanionInteractionRepository {
  constructor(private readonly db: Database) {}

  async create(interaction: CompanionInteraction): Promise<CompanionInteraction> {
    const params: SqlParam[] = [
      interaction.id,
      interaction.companionId,
      interaction.sceneType,
      optionalText(interaction.triggerEvent),
      interaction.interactionType,
      optionalText(interaction.content),
      optionalText(interaction.userResponse),
      optionalText(interaction.animationName),
      toBoolColumn(interaction.requiresResponse),
      optionalText(interaction.conversationId),
      optionalText(interaction.replyToId),
      interaction.turnIndex === undefined ? null : interaction.turnIndex,
      optionalText(interaction.initiator),
      optionalText(interaction.status),
      interaction.role ?? 'pet',
      interaction.createdAt,
    ];
    await this.db.execute(
      `INSERT INTO companion_interactions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    return interaction;
  }

  async findById(id: UUID): Promise<CompanionInteraction | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM companion_interactions WHERE id = ?`,
      [id]
    );
    return row ? toInteraction(row) : null;
  }

  async findLastQuestion(): Promise<CompanionInteraction | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM companion_interactions
       WHERE interaction_type = 'question' ORDER BY created_at DESC LIMIT 1`
    );
    return row ? toInteraction(row) : null;
  }

  /** 最近一条互动（任意类型），主动调度节流用 */
  async findLast(): Promise<CompanionInteraction | null> {
    const row = await this.db.selectOne(
      `SELECT ${COLUMNS} FROM companion_interactions ORDER BY created_at DESC LIMIT 1`
    );
    return row ? toInteraction(row) : null;
  }

  /** 今天已经问了几次。按本地日的起止时刻查（created_at 是 UTC，不能用日期字符串比） */
  async countTodayQuestions(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const row = await this.db.selectOne(
      `SELECT COUNT(*) AS total FROM companion_interactions
       WHERE interaction_type = 'question' AND created_at >= ? AND created_at < ?`,
      [start.toISOString(), end.toISOString()]
    );
    return Number(row?.total ?? 0);
  }

  /** 今天某个场景的互动数（主动调度按场景计日上限） */
  async countTodayByScene(scene: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const row = await this.db.selectOne(
      `SELECT COUNT(*) AS total FROM companion_interactions
       WHERE scene_type = ? AND created_at >= ? AND created_at < ?`,
      [scene, start.toISOString(), end.toISOString()]
    );
    return Number(row?.total ?? 0);
  }

  /** 用户答完就不再需要响应，requires_response 一并落回 0，避免 UI 反复追问 */
  async updateResponse(id: UUID, response: string): Promise<void> {
    await this.db.execute(
      `UPDATE companion_interactions SET user_response = ?, requires_response = 0, status = 'answered' WHERE id = ?`,
      [response, id]
    );
  }

  /** listRecent 的别名。与其他仓储保持一致的 UI 读取入口 */
  listAll(limit = 50): Promise<CompanionInteraction[]> {
    return this.listRecent(limit);
  }

  async listRecent(limit = 50): Promise<CompanionInteraction[]> {

    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM companion_interactions ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toInteraction);
  }

  /** 保留 90 天，超期清理（数据生命周期策略） */
  async purgeOlderThan(days = 90): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.execute('DELETE FROM companion_interactions WHERE created_at < ?', [cutoff]);
  }
}
