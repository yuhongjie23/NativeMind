import type { JobQueuePort } from '@application/ports';
import { toJsonColumn, type SqlDriver } from '../db/database';

/** May run on the queue's database or on the import's transaction-scoped driver. */
export async function enqueueJob(db: Pick<SqlDriver, 'execute'>, job: Parameters<JobQueuePort['enqueue']>[0]): Promise<void> {
  await db.execute(
    `INSERT INTO background_jobs (
       id, job_type, entity_type, entity_id, status, payload, retry_count, max_retries, created_at
     ) VALUES (?, ?, ?, ?, 'pending', ?, 0, 3, ?)`,
    [crypto.randomUUID(), job.type, 'note', job.entityId, toJsonColumn(job.payload ?? {}), new Date().toISOString()],
  );
}
