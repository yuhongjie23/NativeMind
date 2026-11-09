import { expect } from 'vitest';
import type { TauriRuntime } from '@infrastructure/tauri-runtime';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';
import { EmbedChunksJob } from '@infrastructure/background-jobs/embed-job';
import { JobQueue } from '@infrastructure/background-jobs/job-queue';

export async function verifyIndexFailureStatus(runtime: TauriRuntime, invoke: TauriInvoke): Promise<void> {
  const { repositories, jobQueue, vectorStore, embedJob, db } = runtime.infrastructure;
  const note = await runtime.application.useCases.importNote.execute({
    kind: 'text', title: '切分失败恢复验证', content: '切分失败不能让已保存的笔记一直显示处理中。',
  });
  const jobState = () => invoke('db_select', {
    sql: "SELECT status, retry_count FROM background_jobs WHERE entity_id = ? AND job_type = 'chunk_note'", params: [note.id],
  });
  await invoke('db_execute', {
    sql: "CREATE TEMP TRIGGER reject_index_chunks BEFORE INSERT ON note_chunks BEGIN SELECT RAISE(ABORT, 'chunk write fault'); END", params: [],
  });
  try {
    // Fail the status write too: task and note error must roll back together.
    await invoke('db_execute', {
      sql: "CREATE TEMP TRIGGER reject_index_status BEFORE UPDATE OF index_error ON notes WHEN NEW.index_error IS NOT NULL BEGIN SELECT RAISE(ABORT, 'status write fault'); END", params: [],
    });
    try {
      await expect(jobQueue.drain()).rejects.toThrow('status write fault');
      expect(await jobState()).toEqual([{ status: 'running', retry_count: 0 }]);
      expect(await repositories.note.findById(note.id)).toMatchObject({ indexStatus: 'chunking', indexError: undefined });
    } finally { await invoke('db_execute', { sql: 'DROP TRIGGER reject_index_status', params: [] }); }
    await jobQueue.recoverStaleJobs();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await jobQueue.drain();
      const status = attempt === 3 ? 'failed' : 'pending';
      expect(await jobState()).toEqual([{ status, retry_count: attempt }]);
      const saved = await repositories.note.findById(note.id);
      expect(saved).toMatchObject({ content: note.content, updatedAt: note.updatedAt, indexStatus: status });
      expect(saved?.indexError).toContain('chunk write fault');
      if (attempt < 3) expect(await runtime.application.useCases.retryNoteIndex.execute(note.id)).toBe('busy');
    }
  } finally { await invoke('db_execute', { sql: 'DROP TRIGGER reject_index_chunks', params: [] }); }

  expect(await runtime.application.useCases.retryNoteIndex.execute(note.id)).toBe('queued');
  jobQueue.register(new EmbedChunksJob(repositories.note, {
    version: 'failure-recovery-test', embed: async texts => texts.map(() => [1, ...Array<number>(767).fill(0)]),
  }, vectorStore));
  try {
    for (let i = 0; i < 8 && (await jobQueue.listPending()).length; i++) await jobQueue.drain();
    expect(await repositories.note.findById(note.id)).toMatchObject({ content: note.content, indexStatus: 'indexed', indexError: undefined });
    expect(await invoke('db_select', {
      sql: 'SELECT count(*) AS count FROM note_chunk_embeddings WHERE note_id = ?', params: [note.id],
    })).toEqual([{ count: 1 }]);
  } finally { if (embedJob) jobQueue.register(embedJob); }

  // A failure from an older task must not hide a completed index, newer edits,
  // or another pending/running pipeline for the same note.
  for (const status of ['indexed', 'stale', 'indexing'] as const) {
    const guarded = await runtime.application.useCases.importNote.execute({
      kind: 'text', title: `失败状态保护 ${status}`, content: `独立验证 ${status} 状态的笔记。`,
    });
    await repositories.note.updateIndexStatus(guarded.id, status);
    const queue = new JobQueue(db, { batchSize: 1 });
    queue.register({ type: 'chunk_note', run: async () => { throw new Error('old job failed'); } });
    if (status === 'indexing') await queue.enqueue({ type: 'embed_chunks', entityId: guarded.id });
    await queue.drain();
    expect(await repositories.note.findById(guarded.id)).toMatchObject({
      indexStatus: status, indexError: status === 'stale' ? 'old job failed' : undefined,
    });
    await invoke('db_execute', {
      sql: "UPDATE background_jobs SET status = 'cancelled' WHERE entity_id = ?", params: [guarded.id],
    });
  }
}
