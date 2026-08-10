/**
 * KnowledgeLinkRepository 集成测试：真实 SQLite 上验证唯一索引、
 * 归档/恢复、关系类型过滤与确认排序。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeLink } from '@application/ports';
import { Database } from '@infrastructure/db/database';
import { SqliteKnowledgeLinkRepository } from '@infrastructure/db/repositories/knowledge-link-repository';
import { NodeSqliteDriver } from '../sqlite-driver';

const link = (overrides: Partial<KnowledgeLink> = {}): KnowledgeLink => ({
  id: 'link_1',
  fromType: 'note',
  fromId: 'note_a',
  toType: 'note',
  toId: 'note_b',
  relationType: 'prerequisite',
  reason: '理解 B 之前需要先懂 A',
  confidence: 0.8,
  createdBy: 'user_manual',
  confirmedByUser: true,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  ...overrides,
});

describe('SqliteKnowledgeLinkRepository（真实 SQLite）', () => {
  let driver: NodeSqliteDriver;
  let repo: SqliteKnowledgeLinkRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver();
    await new Database(driver).migrate();
    repo = new SqliteKnowledgeLinkRepository(new Database(driver));
  });

  afterEach(async () => {
    await driver.close();
  });

  it('保存后按 id 与边查询都能命中', async () => {
    await repo.save(link());

    expect((await repo.findById('link_1'))?.relationType).toBe('prerequisite');
    expect(
      await repo.findEdge({
        fromType: 'note',
        fromId: 'note_a',
        toType: 'note',
        toId: 'note_b',
        relationType: 'prerequisite',
      })
    ).not.toBeNull();
  });

  it('同一条边重复保存由唯一索引兜底，只更新不新增', async () => {
    await repo.save(link());
    await repo.save(link({ reason: '更新后的理由', confidence: 0.9 }));

    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBe('更新后的理由');
    expect(all[0].confidence).toBe(0.9);
  });

  it('归档后默认查询不再返回，恢复后重新出现', async () => {
    await repo.save(link());
    await repo.archive('link_1', '2026-08-02T12:00:00.000Z');

    expect(await repo.listAll()).toHaveLength(0);
    expect(await repo.query({ includeArchived: true })).toHaveLength(1);

    await repo.restore('link_1', '2026-08-02T12:30:00.000Z');
    const restored = await repo.findById('link_1');
    expect(restored?.archivedAt).toBeUndefined();
  });

  it('按关系类型过滤', async () => {
    await repo.save(link({ id: 'l1' }));
    await repo.save(link({ id: 'l2', relationType: 'contrast', toId: 'note_c' }));

    const contrasts = await repo.query({ relationTypes: ['contrast'] });
    expect(contrasts.map((l) => l.id)).toEqual(['l2']);
  });

  it('已确认的排在未确认前面', async () => {
    await repo.save(link({ id: 'unconfirmed', toId: 'note_c', confirmedByUser: false, confidence: 0.99 }));
    await repo.save(link({ id: 'confirmed', toId: 'note_d', confidence: 0.6 }));

    const all = await repo.listAll();
    expect(all.map((l) => l.id)).toEqual(['confirmed', 'unconfirmed']);
  });

  it('查询某实体时起点和终点两侧都算', async () => {
    await repo.save(link({ id: 'as_from' }));
    await repo.save(link({ id: 'as_to', fromId: 'note_c', toId: 'note_a' }));

    const around = await repo.query({ entity: { type: 'note', id: 'note_a' } });
    expect(around.map((l) => l.id).sort()).toEqual(['as_from', 'as_to']);
  });
});
