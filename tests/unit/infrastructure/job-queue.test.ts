/**
 * 队列行为单测：重试、放弃、专注期间暂停、启动恢复
 * 这几条直接决定「导入的笔记会不会永远卡在索引中」，所以必须覆盖。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Database } from '@infrastructure/db/database';
import { JobQueue, type Job, type JobHandler } from '@infrastructure/background-jobs/job-queue';
import { MemoryDriver } from './memory-driver';

const pendingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  job_type: 'parse_note',
  entity_id: 'note-1',
  status: 'pending',
  payload: '{}',
  error_message: null,
  retry_count: 0,
  max_retries: 3,
  created_at: '2026-07-31T00:00:00.000Z',
  ...overrides,
});

const PENDING_QUERY = "FROM background_jobs WHERE status = 'pending'";

class RecordingHandler implements JobHandler {
  readonly type = 'parse_note' as const;
  readonly seen: string[] = [];

  constructor(private readonly behaviour: 'ok' | 'throw' = 'ok') {}

  async run(job: Job): Promise<void> {
    this.seen.push(job.entityId);
    if (this.behaviour === 'throw') throw new Error('解析失败');
  }
}

describe('JobQueue', () => {
  let driver: MemoryDriver;
  let db: Database;

  beforeEach(() => {
    driver = new MemoryDriver();
    db = new Database(driver);
  });

  it('成功后标记 completed', async () => {
    driver.stub(PENDING_QUERY, [pendingRow()]);
    const queue = new JobQueue(db);
    const handler = new RecordingHandler();
    queue.register(handler);

    expect(await queue.drain()).toBe(1);
    expect(handler.seen).toEqual(['note-1']);
    expect(driver.findCall("status = 'completed'")).toBeDefined();
  });

  it('还有重试次数时退回 pending', async () => {
    driver.stub(PENDING_QUERY, [pendingRow({ retry_count: 0 })]);
    const queue = new JobQueue(db);
    queue.register(new RecordingHandler('throw'));

    expect(await queue.drain()).toBe(0);

    const failCall = driver.findCall('retry_count = retry_count + 1');
    expect(failCall?.params[0]).toBe('pending');
    expect(failCall?.params[1]).toBe('解析失败');
  });

  it('重试次数用尽后标 failed', async () => {
    driver.stub(PENDING_QUERY, [pendingRow({ retry_count: 2, max_retries: 3 })]);
    const queue = new JobQueue(db);
    queue.register(new RecordingHandler('throw'));

    await queue.drain();

    expect(driver.findCall('retry_count = retry_count + 1')?.params[0]).toBe('failed');
  });

  it('没有注册处理器时直接放弃，不无限重试', async () => {
    driver.stub(PENDING_QUERY, [pendingRow({ job_type: 'embed_chunks' })]);
    const queue = new JobQueue(db);

    await queue.drain();

    const failCall = driver.findCall('retry_count = retry_count + 1');
    expect(failCall?.params[0]).toBe('failed');
    expect(String(failCall?.params[1])).toContain('embed_chunks');
  });

  it('canRun 为 false 时一条都不跑', async () => {
    driver.stub(PENDING_QUERY, [pendingRow()]);
    const queue = new JobQueue(db, { canRun: () => false });
    const handler = new RecordingHandler();
    queue.register(handler);

    expect(await queue.drain()).toBe(0);
    expect(handler.seen).toEqual([]);
    expect(driver.countMatching('background_jobs')).toBe(0);
  });

  it('恢复上次异常退出的 running 任务', async () => {
    const queue = new JobQueue(db);
    await queue.recoverStaleJobs();

    expect(driver.findCall("WHERE status = 'running'")).toBeDefined();
  });

  it('入队写入 pending 记录', async () => {
    const queue = new JobQueue(db);
    await queue.enqueue({ type: 'chunk_note', entityId: 'note-9', payload: { reason: 'update' } });

    const call = driver.findCall('INSERT INTO background_jobs');
    expect(call?.params).toContain('chunk_note');
    expect(call?.params).toContain('note-9');
    expect(call?.params).toContain('{"reason":"update"}');
  });
});
