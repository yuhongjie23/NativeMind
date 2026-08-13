/**
 * 支撑型 Repository：苏格拉底会话、待确认动作、审计、模型日志、设置
 *
 * 这几个表结构简单、彼此关联少，合在一个文件里比拆五个文件更好读。
 * 真要长大了（比如苏格拉底加分析查询）再拆出去。
 */
import type { ActionProposal, ActionProposalRepository, ProposalStatus } from '@application/confirmation/action-proposal';
import type {
  AuditRepository,
  SocraticExchange,
  SocraticRepository,
  SocraticSession,
} from '@application/ports';
import type { ModelRunLog, ModelRunRecorder } from '@ai/types';
import type { ISO8601DateTime, UUID } from '@shared-types/common';
import {
  fromBoolColumn,
  fromJsonColumn,
  optionalText,
  readText,
  toBoolColumn,
  toJsonColumn,
  type Database,
  type SqlRow,
} from '../database';

/* ---------- 苏格拉底会话 ---------- */

const SESSION_COLUMNS = `id, topic, related_note_ids, status, created_at, updated_at`;
const EXCHANGE_COLUMNS = `id, session_id, turn_number, question, user_response, ai_feedback, created_at`;

const toSession = (row: SqlRow): SocraticSession => ({
  id: String(row.id),
  topic: String(row.topic),
  relatedNoteIds: fromJsonColumn<UUID[]>(row.related_note_ids, []),
  status: String(row.status) as SocraticSession['status'],
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const toExchange = (row: SqlRow): SocraticExchange => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  turnNumber: Number(row.turn_number),
  question: String(row.question),
  userResponse: readText(row.user_response),
  aiFeedback: readText(row.ai_feedback),
  createdAt: String(row.created_at),
});

export class SqliteSocraticRepository implements SocraticRepository {
  constructor(private readonly db: Database) {}

  async saveSession(session: SocraticSession): Promise<void> {
    await this.db.execute(
      `INSERT INTO socratic_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         topic = excluded.topic,
         related_note_ids = excluded.related_note_ids,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        session.id,
        session.topic,
        toJsonColumn(session.relatedNoteIds),
        session.status,
        session.createdAt,
        session.updatedAt,
      ]
    );
  }

  async findSession(id: UUID): Promise<SocraticSession | null> {
    const row = await this.db.selectOne(
      `SELECT ${SESSION_COLUMNS} FROM socratic_sessions WHERE id = ?`,
      [id]
    );
    return row ? toSession(row) : null;
  }

  /**
   * 会话列表，最近更新的在前。
   *
   * 按 updated_at 排而不是 created_at：刚答过一轮的会话应该浮到最上面，
   * 那才是用户想继续的那个。
   */
  async listSessions(limit = 50): Promise<SocraticSession[]> {
    const rows = await this.db.select(
      `SELECT ${SESSION_COLUMNS} FROM socratic_sessions ORDER BY updated_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toSession);
  }

  /** 追问的答案是后续补写的，所以这里也要能更新已有轮次 */
  async saveExchange(exchange: SocraticExchange): Promise<void> {

    await this.db.execute(
      `INSERT INTO socratic_exchanges (${EXCHANGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         question = excluded.question,
         user_response = excluded.user_response,
         ai_feedback = excluded.ai_feedback`,
      [
        exchange.id,
        exchange.sessionId,
        exchange.turnNumber,
        exchange.question,
        optionalText(exchange.userResponse),
        optionalText(exchange.aiFeedback),
        exchange.createdAt,
      ]
    );
  }

  async countExchanges(sessionId: UUID): Promise<number> {
    const row = await this.db.selectOne(
      'SELECT COUNT(*) AS total FROM socratic_exchanges WHERE session_id = ?',
      [sessionId]
    );
    return Number(row?.total ?? 0);
  }

  async listExchanges(sessionId: UUID): Promise<SocraticExchange[]> {
    const rows = await this.db.select(
      `SELECT ${EXCHANGE_COLUMNS} FROM socratic_exchanges WHERE session_id = ? ORDER BY turn_number`,
      [sessionId]
    );
    return rows.map(toExchange);
  }
}

/* ---------- 待确认动作 ---------- */

const PROPOSAL_COLUMNS = `id, action_type, summary, payload, source, status,
       requires_confirmation, created_at, decided_at`;

const toProposal = (row: SqlRow): ActionProposal => ({
  id: String(row.id),
  actionType: String(row.action_type) as ActionProposal['actionType'],
  summary: String(row.summary),
  payload: fromJsonColumn<unknown>(row.payload, null),
  source: String(row.source) as ActionProposal['source'],
  status: String(row.status) as ProposalStatus,
  requiresConfirmation: fromBoolColumn(row.requires_confirmation),
  createdAt: String(row.created_at),
  decidedAt: readText(row.decided_at),
});

export class SqliteActionProposalRepository implements ActionProposalRepository {
  constructor(private readonly db: Database) {}

  async save(proposal: ActionProposal): Promise<void> {
    await this.db.execute(
      `INSERT INTO action_proposals (${PROPOSAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         summary = excluded.summary,
         payload = excluded.payload,
         status = excluded.status,
         decided_at = excluded.decided_at`,
      [
        proposal.id,
        proposal.actionType,
        proposal.summary,
        toJsonColumn(proposal.payload),
        proposal.source,
        proposal.status,
        toBoolColumn(proposal.requiresConfirmation),
        proposal.createdAt,
        optionalText(proposal.decidedAt),
      ]
    );
  }

  async findById(id: UUID): Promise<ActionProposal | null> {
    const row = await this.db.selectOne(
      `SELECT ${PROPOSAL_COLUMNS} FROM action_proposals WHERE id = ?`,
      [id]
    );
    return row ? toProposal(row) : null;
  }

  async updateStatus(id: UUID, status: ProposalStatus, decidedAt: ISO8601DateTime): Promise<void> {
    await this.db.execute('UPDATE action_proposals SET status = ?, decided_at = ? WHERE id = ?', [
      status,
      decidedAt,
      id,
    ]);
  }

  async listPending(limit = 20): Promise<ActionProposal[]> {
    const rows = await this.db.select(
      `SELECT ${PROPOSAL_COLUMNS} FROM action_proposals
       WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toProposal);
  }

  /**
   * 把长时间没人理的 pending 标为 expired。
   * 不然用户过几天回来会看到一堆早已失去上下文的旧建议。
   */
  async expireOlderThan(hours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
    return this.db.execute(
      `UPDATE action_proposals SET status = 'expired', decided_at = ?
       WHERE status = 'pending' AND created_at < ?`,
      [new Date().toISOString(), cutoff]
    );
  }
}

/* ---------- 审计日志 ---------- */

export class SqliteAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}

  async log(entry: { eventType: string; payload: unknown; timestamp: ISO8601DateTime }): Promise<void> {
    await this.db.execute(
      'INSERT INTO audit_logs (id, event_type, payload, created_at) VALUES (?, ?, ?, ?)',
      [crypto.randomUUID(), entry.eventType, toJsonColumn(entry.payload), entry.timestamp]
    );
  }

  async listRecent(limit = 100): Promise<{ eventType: string; payload: unknown; timestamp: string }[]> {
    const rows = await this.db.select(
      'SELECT event_type, payload, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rows.map((row) => ({
      eventType: String(row.event_type),
      payload: fromJsonColumn<unknown>(row.payload, null),
      timestamp: String(row.created_at),
    }));
  }
}

/* ---------- 模型调用日志 ---------- */

/** ai 层的 validationResult 用的是 passed/failed/skipped，表里的枚举更细，这里做一次映射 */
const VALIDATION_MAP: Record<ModelRunLog['validationResult'], string> = {
  passed: 'success',
  failed: 'schema_failed',
  skipped: 'success',
};

export class SqliteModelRunRecorder implements ModelRunRecorder {
  constructor(private readonly db: Database) {}

  async record(log: ModelRunLog): Promise<void> {
    await this.db.execute(
      `INSERT INTO model_runs (
        id, task_type, model_tier, model_name, prompt_version, schema_id,
        input_hash, output, validation_result, user_correction, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        log.taskType,
        log.tier,
        log.model,
        optionalText(log.promptVersion),
        optionalText(log.schemaId),
        log.inputHash,
        optionalText(log.output),
        VALIDATION_MAP[log.validationResult],
        optionalText(log.userCorrection),
        log.createdAt,
      ]
    );
  }

  /** 只保留 30 天，用户也可以在设置里手动清 */
  async purgeOlderThan(days = 30): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.execute('DELETE FROM model_runs WHERE created_at < ?', [cutoff]);
  }
}

/* ---------- 设置 ---------- */

export class SqliteSettingsRepository {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.selectOne('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? String(row.value) : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()]
    );
  }

  /** 一次写多个键，全部在同一个事务里：中途失败不留半组配置 */
  async setMany(entries: Record<string, string>): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(entries)) {
        await tx.execute(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [key, value, timestamp]
        );
      }
    });
  }

  /** 一次读全部，启动时灌进设置 store */
  async getAll(): Promise<Record<string, string>> {
    const rows = await this.db.select('SELECT key, value FROM settings');
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[String(row.key)] = String(row.value);
      return acc;
    }, {});
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.get(key);
    if (raw === null) return fallback;
    return raw === 'true' || raw === '1';
  }
}
