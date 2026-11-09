import { expect } from 'vitest';
import type { TauriRuntime } from '@infrastructure/tauri-runtime';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';
import { EmbedChunksJob } from '@infrastructure/background-jobs/embed-job';

export async function verifyRetryNoteIndex(runtime: TauriRuntime, invoke: TauriInvoke): Promise<void> {
  const repo = runtime.infrastructure.repositories.note;
  const note = await runtime.application.useCases.importNote.execute({ kind: 'text', title: '索引重试验证', content: '这段正文已经保存，不依赖原文件的位置。' });
  await repo.save({ ...note, sourceUri: 'Z:/missing-original-note.txt' });
  await invoke('db_execute', { sql: "UPDATE background_jobs SET status = 'failed', retry_count = 3 WHERE entity_id = ?", params: [note.id] });
  await repo.updateIndexStatus(note.id, 'indexing', { error: '旧模型未安装' });
  const retry = runtime.application.useCases.retryNoteIndex;
  await invoke('db_execute', { sql: "CREATE TEMP TRIGGER reject_retry BEFORE INSERT ON background_jobs WHEN NEW.job_type = 'chunk_note' BEGIN SELECT RAISE(ABORT, 'retry enqueue fault'); END", params: [] });
  try {
    await expect(retry.execute(note.id)).rejects.toThrow('retry enqueue fault');
    expect(await repo.findById(note.id)).toMatchObject({ indexStatus: 'indexing', indexError: '旧模型未安装' });
  } finally { await invoke('db_execute', { sql: 'DROP TRIGGER reject_retry', params: [] }); }
  const results = await Promise.all([retry.execute(note.id), retry.execute(note.id)]);
  expect(results.sort()).toEqual(['busy', 'queued']);
  const refreshed = await repo.findById(note.id);
  expect(refreshed).toMatchObject({ content: note.content, updatedAt: note.updatedAt, indexStatus: 'pending', indexError: undefined });
  const jobs = await invoke<Array<{ job_type: string; status: string }>>('db_select', {
    sql: 'SELECT job_type, status FROM background_jobs WHERE entity_id = ?', params: [note.id],
  });
  expect(jobs.filter(job => job.status === 'pending')).toEqual([{ job_type: 'chunk_note', status: 'pending' }]);
  expect(jobs.filter(job => job.status === 'failed')).toHaveLength(1);
  await invoke('db_execute', { sql: "UPDATE background_jobs SET status = 'running' WHERE entity_id = ? AND status = 'pending'", params: [note.id] });
  expect(await retry.execute(note.id)).toBe('busy');
  await invoke('db_execute', { sql: "UPDATE background_jobs SET status = 'pending' WHERE entity_id = ? AND status = 'running'", params: [note.id] });

  const original = runtime.infrastructure.embedJob!;
  runtime.infrastructure.jobQueue.register(new EmbedChunksJob(repo, {
    version: 'retry-test', embed: async texts => texts.map(() => [1, ...Array<number>(767).fill(0)]),
  }, runtime.infrastructure.vectorStore));
  try {
    for (let i = 0; i < 8 && (await runtime.infrastructure.jobQueue.listPending()).length; i++) await runtime.infrastructure.jobQueue.drain();
    expect(await repo.findById(note.id)).toMatchObject({ content: note.content, indexStatus: 'indexed', indexError: undefined });
    expect(await invoke('db_select', { sql: 'SELECT count(*) AS count FROM note_chunk_embeddings WHERE note_id = ?', params: [note.id] })).toEqual([{ count: 1 }]);
  } finally { runtime.infrastructure.jobQueue.register(original); }
  await expect(retry.execute('missing-note')).rejects.toThrow('不存在');
  const empty = { ...note, id: crypto.randomUUID(), content: ' \u200B ' };
  await repo.save(empty);
  await expect(retry.execute(empty.id)).rejects.toThrow('正文为空');
  await repo.delete(empty.id);
}
