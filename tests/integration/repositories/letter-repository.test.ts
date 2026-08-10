/**
 * Flora 信件仓储集成测试（真 SQLite）
 *
 * 验证 013 迁移建表 + upsert + list 倒序 + listPendingDue 到期过滤。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Letter } from '@application/ports';
import { Database } from '@infrastructure/db/database';
import { SqliteLetterRepository } from '@infrastructure/db/repositories/letter-repository';
import { NodeSqliteDriver } from '../sqlite-driver';

const letter = (overrides: Partial<Letter> = {}): Letter => ({
  id: 'letter-1',
  letter: '你好 Flora',
  language: 'zh',
  direction: 'out',
  type: 'warm',
  sendAfter: '2026-08-06T00:00:00.000Z',
  status: 'pending',
  createdAt: '2026-08-05T12:00:00.000Z',
  ...overrides,
});

describe('SqliteLetterRepository', () => {
  let repo: SqliteLetterRepository;

  beforeEach(async () => {
    const db = new Database(new NodeSqliteDriver());
    await db.migrate(); // 全量迁移，含 013_letters
    repo = new SqliteLetterRepository(db);
  });

  it('保存后可读回，emotion JSON / 状态往返一致', async () => {
    await repo.save(letter({ reply: 'dear love, 加油', emotion: { emotion: '累', summary: 's', tone: 't' }, status: 'sent' }));
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('sent');
    expect(list[0].emotion?.emotion).toBe('累');
    expect(list[0].reply).toContain('dear love');
  });

  it('list 最近在前', async () => {
    await repo.save(letter({ id: 'a', createdAt: '2026-08-05T12:00:00.000Z' }));
    await repo.save(letter({ id: 'b', createdAt: '2026-08-05T13:00:00.000Z' }));
    const list = await repo.list();
    expect(list.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('listPendingDue 只返回到期未发', async () => {
    await repo.save(letter({ id: 'due', sendAfter: '2026-08-05T10:00:00.000Z' }));
    await repo.save(letter({ id: 'future', sendAfter: '2026-08-06T00:00:00.000Z' }));
    await repo.save(letter({ id: 'sent', sendAfter: '2026-08-05T10:00:00.000Z', status: 'sent' }));

    const due = await repo.listPendingDue('2026-08-05T12:00:00.000Z');

    expect(due.map((l) => l.id)).toEqual(['due']);
  });
});
