/**
 * 深度问答历史仓储集成测试（真 SQLite）
 *
 * 验证 011 迁移建表 + citations JSON 往返 + 布尔列 0/1 映射 + 倒序列表。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AskSession } from '@application/ports';
import { Database } from '@infrastructure/db/database';
import { SqliteAskSessionRepository } from '@infrastructure/db/repositories/ask-repository';
import { NodeSqliteDriver } from '../sqlite-driver';

const session = (overrides: Partial<AskSession> = {}): AskSession => ({
  id: 'ask-1',
  question: 'LoRA 是什么',
  answer: '低秩分解方法，用于高效微调大模型',
  citations: [{ chunkId: 'c1', noteId: 'n1', text: 'LoRA 通过低秩分解…', score: 0.8, headingPath: ['大模型'] }],
  confidence: 0.86,
  judged: true,
  regenerated: false,
  ok: true,
  empty: false,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

describe('SqliteAskSessionRepository', () => {
  let repo: SqliteAskSessionRepository;

  beforeEach(async () => {
    const db = new Database(new NodeSqliteDriver());
    await db.migrate(); // 全量迁移，含 011_ask_sessions
    repo = new SqliteAskSessionRepository(db);
  });

  it('保存后可列出，citations / 布尔字段往返一致', async () => {
    await repo.save(session());

    const list = await repo.list();

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(session());
  });

  it('列表按创建时间倒序（最近的在前）', async () => {
    await repo.save(session({ id: 'ask-1', createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }));
    await repo.save(session({ id: 'ask-2', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z' }));

    const list = await repo.list();

    expect(list.map((s) => s.id)).toEqual(['ask-2', 'ask-1']);
  });

  it('删除存在的返回 true 并从列表消失；不存在返回 false', async () => {
    await repo.save(session());

    expect(await repo.delete('ask-1')).toBe(true);
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.delete('no-such-id')).toBe(false);
  });
});
