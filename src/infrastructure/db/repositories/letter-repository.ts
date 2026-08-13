/**
 * Flora 信件 Repository
 *
 * emotion 以 JSON 落库。list 按创建时间倒序；listPendingDue 按 sendAfter 取到期未发。
 */
import type { Letter, LetterRepository } from '@application/ports';
import { fromJsonColumn, optionalText, readText, toJsonColumn, type Database, type SqlRow } from '../database';

const COLUMNS = `id, letter, language, direction, type, send_after, status, reply, emotion, created_at, sent_at, conversation_id`;

const toLetter = (row: SqlRow): Letter => ({
  id: String(row.id),
  letter: String(row.letter),
  language: String(row.language) as Letter['language'],
  direction: String(row.direction ?? 'out') as Letter['direction'],
  type: String(row.type ?? 'warm') as Letter['type'],
  sendAfter: String(row.send_after),
  status: String(row.status) as Letter['status'],
  reply: readText(row.reply),
  emotion: fromJsonColumn<Letter['emotion']>(row.emotion, undefined),
  createdAt: String(row.created_at),
  sentAt: readText(row.sent_at),
  conversationId: readText(row.conversation_id),
});

export class SqliteLetterRepository implements LetterRepository {
  constructor(private readonly db: Database) {}

  /**
   * 迁移前修复：老库可能「列已存在但 schema_migrations 未记录 14/15」
   * （例如之前某次运行在 migrate 前补过列）。此时若让 migrate 再跑 014/015 的
   * ALTER 会报 "duplicate column"。这里把已存在的列对应版本标记为已应用，
   * migrate 就会跳过。列不存在时不动，交给 migrate 正常加。
   */
  async syncSchemaState(): Promise<void> {
    try {
      const cols = await this.db.select('PRAGMA table_info(letters)', []);
      const names = new Set(cols.map((row) => String(row.name)));
      const applied = await this.db.select(
        'SELECT version FROM schema_migrations WHERE version IN (14, 15)',
        []
      );
      const versions = new Set(applied.map((row) => Number(row.version)));
      const timestamp = new Date().toISOString();
      if (names.has('direction') && !versions.has(14)) {
        await this.db.execute(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (14, ?, ?)',
          ['add_letter_direction', timestamp]
        );
      }
      if (names.has('type') && !versions.has(15)) {
        await this.db.execute(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (15, ?, ?)',
          ['add_letter_type', timestamp]
        );
      }
    } catch {
      // letters 表还没建（首次启动，migrate 未跑）——忽略，等 migrate 正常建
    }
  }

  async save(letter: Letter): Promise<void> {
    await this.db.execute(
      `INSERT INTO letters (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         letter = excluded.letter,
         language = excluded.language,
         direction = excluded.direction,
         type = excluded.type,
         send_after = excluded.send_after,
         status = excluded.status,
         reply = excluded.reply,
         emotion = excluded.emotion,
         sent_at = excluded.sent_at,
         conversation_id = excluded.conversation_id`,
      [
        letter.id,
        letter.letter,
        letter.language,
        letter.direction ?? 'out',
        letter.type ?? 'warm',
        letter.sendAfter,
        letter.status,
        optionalText(letter.reply),
        toJsonColumn(letter.emotion),
        letter.createdAt,
        optionalText(letter.sentAt),
        optionalText(letter.conversationId),
      ]
    );
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.db.execute(
      `DELETE FROM letters WHERE id IN (${placeholders})`,
      ids
    );
    return Number(result);
  }

  async list(limit = 50): Promise<Letter[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM letters ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(toLetter);
  }

  async listPendingDue(nowIso: string): Promise<Letter[]> {
    const rows = await this.db.select(
      `SELECT ${COLUMNS} FROM letters WHERE status = 'pending' AND send_after <= ? ORDER BY send_after`,
      [nowIso]
    );
    return rows.map(toLetter);
  }
}
