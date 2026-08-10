/**
 * ReindexNoteJob 单测
 *
 * 这是「编辑笔记内容 → 重建索引」链路的回归测试：之前 reindex_note 没有
 * 注册处理器，任务会因「没有注册的处理器」被标记 failed，编辑过的笔记
 * 永远停在 stale。有了这个处理器，它会转发回 parse_note 复用整条流水线。
 */
import { describe, expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { JobQueue } from '@infrastructure/background-jobs/job-queue';
import { ReindexNoteJob } from '@infrastructure/background-jobs/reindex-note-job';
import { MemoryDriver } from './memory-driver';

describe('ReindexNoteJob', () => {
  it('把 reindex_note 转发成 parse_note，且任务被标记完成而非失败', async () => {
    const driver = new MemoryDriver();
    const db = new Database(driver);
    const queue = new JobQueue(db);
    queue.register(new ReindexNoteJob(queue));

    driver.stub("WHERE status = 'pending'", [
      {
        id: 'job-1',
        job_type: 'reindex_note',
        entity_id: 'note-1',
        status: 'pending',
        payload: '{}',
        error_message: null,
        retry_count: 0,
        max_retries: 3,
        created_at: '2026-07-31T00:00:00.000Z',
      },
    ]);

    await queue.drain();

    // 处理器转发：入队一条 parse_note（复用 parse → chunk → embed 链路）
    const forwarded = driver.calls.find(
      (call) =>
        call.sql.includes('INSERT INTO background_jobs') && call.params.includes('parse_note')
    );
    expect(forwarded).toBeDefined();
    expect(forwarded!.params).toContain('note-1');

    // reindex_note 正常完成，而不是被标 failed
    expect(driver.findCall("status = 'completed'")).toBeDefined();
    expect(
      driver.calls.some(
        (call) =>
          call.sql.includes('retry_count = retry_count + 1') && call.params.includes('failed')
      )
    ).toBe(false);
  });
});
