/**
 * 后台任务队列（落库版，支持重试与断点续传）
 *
 * 队列状态存在 background_jobs 表里，所以应用被强杀后重启，
 * 上次跑到一半的索引能接着做，不用整份重来。
 *
 * 专注期间不跑占资源的 Job：embedding 会把显存吃满，
 * 用户正在专注时弹出卡顿是最糟的体验，所以调度前先问 canRun（FocusModePolicy 注入）。
 */
import type { JobQueuePort, JobType } from '@application/ports';
import type { UUID } from '@shared-types/common';
import { fromJsonColumn, readText, toJsonColumn, type Database } from '../db/database';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: UUID;
  type: JobType;
  entityId: UUID;
  status: JobStatus;
  payload: Record<string, unknown>;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
}

/** 单个 Job 的处理器。抛错即视为失败，由队列决定重试还是放弃 */
export interface JobHandler {
  readonly type: JobType;
  run(job: Job): Promise<void>;
}

export interface JobQueueOptions {
  /** 返回 false 时暂停消费（专注模式、电量低等） */
  canRun?: () => boolean | Promise<boolean>;
  /** 每轮最多处理多少个，避免一次 tick 占用太久 */
  batchSize?: number;
}

const toJob = (row: Record<string, unknown>): Job => ({
  id: String(row.id),
  type: String(row.job_type) as JobType,
  entityId: String(row.entity_id),
  status: String(row.status) as JobStatus,
  payload: fromJsonColumn<Record<string, unknown>>(row.payload, {}),
  errorMessage: readText(row.error_message),
  retryCount: Number(row.retry_count ?? 0),
  maxRetries: Number(row.max_retries ?? 3),
  createdAt: String(row.created_at),
});

export class JobQueue implements JobQueuePort {
  private readonly handlers = new Map<JobType, JobHandler>();
  private readonly batchSize: number;
  private readonly canRun: () => boolean | Promise<boolean>;
  /** 防止定时器和手动调用同时进入消费循环 */
  private draining = false;

  constructor(
    private readonly db: Database,
    options: JobQueueOptions = {}
  ) {
    this.canRun = options.canRun ?? (() => true);
    this.batchSize = options.batchSize ?? 5;
  }

  register(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
  }

  async enqueue(job: { type: JobType; entityId: UUID; payload?: Record<string, unknown> }): Promise<void> {
    await this.db.execute(
      `INSERT INTO background_jobs (
         id, job_type, entity_type, entity_id, status, payload, retry_count, max_retries, created_at
       ) VALUES (?, ?, ?, ?, 'pending', ?, 0, 3, ?)`,
      [
        crypto.randomUUID(),
        job.type,
        'note',
        job.entityId,
        toJsonColumn(job.payload ?? {}),
        new Date().toISOString(),
      ]
    );
  }

  /**
   * 启动时调用：把上次异常退出留下的 running 复位成 pending。
   * 不复位的话这些任务会永远卡在 running，笔记也就永远停在「索引中」。
   */
  async recoverStaleJobs(): Promise<number> {
    return this.db.execute(
      `UPDATE background_jobs SET status = 'pending', started_at = NULL WHERE status = 'running'`
    );
  }

  async listPending(limit = this.batchSize): Promise<Job[]> {
    const rows = await this.db.select(
      `SELECT id, job_type, entity_id, status, payload, error_message, retry_count, max_retries, created_at
       FROM background_jobs WHERE status = 'pending' ORDER BY created_at LIMIT ?`,
      [limit]
    );
    return rows.map(toJob);
  }

  /** 消费一批。返回成功处理的数量，供调用方决定是否立刻再来一轮 */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    if (!(await this.canRun())) return 0;

    this.draining = true;
    let processed = 0;

    try {
      const jobs = await this.listPending();
      for (const job of jobs) {
        // 每个 Job 之前重新问一次：专注可能在这一批中途开始
        if (!(await this.canRun())) break;
        if (await this.runOne(job)) processed += 1;
      }
    } finally {
      this.draining = false;
    }

    return processed;
  }

  private async runOne(job: Job): Promise<boolean> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.fail(job, `没有注册 ${job.type} 的处理器`, true);
      return false;
    }

    await this.db.execute(
      `UPDATE background_jobs SET status = 'running', started_at = ? WHERE id = ?`,
      [new Date().toISOString(), job.id]
    );

    try {
      await handler.run(job);
      await this.db.execute(
        `UPDATE background_jobs SET status = 'completed', completed_at = ?, error_message = NULL WHERE id = ?`,
        [new Date().toISOString(), job.id]
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.fail(job, message, job.retryCount + 1 >= job.maxRetries);
      return false;
    }
  }

  /** 还有重试次数就退回 pending，用完了才标 failed 并让 UI 提示用户 */
  private async fail(job: Job, message: string, giveUp: boolean): Promise<void> {
    await this.db.execute(
      `UPDATE background_jobs SET
         status = ?, retry_count = retry_count + 1, error_message = ?, completed_at = ?
       WHERE id = ?`,
      [giveUp ? 'failed' : 'pending', message, giveUp ? new Date().toISOString() : null, job.id]
    );
  }

  /** 清理 7 天前已完成的记录，并顺带清掉超期的 failed（否则反复失败的任务永久堆积） */
  async purgeCompleted(days = 7): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.execute(
      `DELETE FROM background_jobs WHERE status = 'completed' AND created_at < ?
       OR status = 'failed' AND created_at < ?`,
      [cutoff, cutoff]
    );
  }
}
