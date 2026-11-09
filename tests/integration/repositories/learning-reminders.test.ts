import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { SqliteLearningRepository } from '@infrastructure/db/repositories/learning-repository';
import { NodeSqliteDriver } from '../sqlite-driver';
import type { LearningReminder, LearningKnowledge } from '@application/ports';

describe('学习计划持久化（真实 SQLite）', () => {
  it('关闭并重开数据库保留提醒、自评历史；并发旧版本只允许一个更新', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nativemind-learning-'));
    let db = new Database(new NodeSqliteDriver(join(dir, 'test.db')));
    try {
      await db.migrate(); const repo = new SqliteLearningRepository(db);
      const time = '2026-11-06T00:00:00Z';
      const reminder: LearningReminder = { id: 'r', title: '复习 <中文> & 边界', kind: 'review', dueAt: time, anchorAt: time, repeat: 'daily', state: 'scheduled', revision: 1, createdAt: time, updatedAt: time, history: [] };
      const knowledge: LearningKnowledge = { id: 'k', title: '二分查找', revision: 1, createdAt: time, updatedAt: time, observations: [{ at: time, rating: 'forgotten', difficulty: '边界', result: '未能复述' }] };
      expect(await repo.saveReminder(reminder, null)).toBe(true);
      expect(await repo.saveKnowledge(knowledge, null)).toBe(true);
      expect(await repo.saveReminder(reminder, null)).toBe(false);
      const updates = await Promise.all([repo.saveReminder({ ...reminder, revision: 2, state: 'stopped' }, 1), repo.saveReminder({ ...reminder, revision: 2, state: 'completed' }, 1)]);
      expect(updates.filter(Boolean)).toHaveLength(1);
      await db.close(); db = new Database(new NodeSqliteDriver(join(dir, 'test.db'))); await db.migrate();
      const reopened = new SqliteLearningRepository(db);
      expect(await reopened.findReminder('r')).toMatchObject({ title: reminder.title, revision: 2, state: 'stopped' });
      expect(await reopened.findKnowledge('k')).toEqual(knowledge);
      expect(await reopened.saveKnowledge({ ...knowledge, revision: 2, observations: [...knowledge.observations, { at: time, rating: 'familiar', difficulty: '', result: '能解释了' }] }, 1)).toBe(true);
      expect(await reopened.saveKnowledge({ ...knowledge, revision: 2 }, 1)).toBe(false);
      expect((await reopened.findKnowledge('k'))?.observations.map(item => item.rating)).toEqual(['forgotten', 'familiar']);
    } finally { await db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
