import { expect } from 'vitest';
import type { TauriRuntime } from '@infrastructure/tauri-runtime';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';
import { EmbedChunksJob } from '@infrastructure/background-jobs/embed-job';

/** Reindex saved edits even after a prior job changed their status and the source disappeared. */
export async function verifyReindexEditedNote(runtime: TauriRuntime, invoke: TauriInvoke): Promise<void> {
  const { repositories, jobQueue, vectorStore, embedJob } = runtime.infrastructure;
  const note = await runtime.application.useCases.importNote.execute({
    kind: 'text', title: '编辑后自动索引验证', content: '原始文件中的旧正文。',
  });
  await invoke('db_execute', {
    sql: "UPDATE background_jobs SET status = 'completed' WHERE entity_id = ?", params: [note.id],
  });
  await repositories.note.save({ ...note, sourceUri: 'Z:/missing-edited-note-original.txt' });
  const edited = await runtime.application.useCases.updateNote.execute(note.id, {
    content: '用户已修改的正文：复习时先主动回忆，再对照笔记检查遗漏。',
  });
  // A failed/interrupted pipeline may already have replaced 'stale' with another stage.
  await repositories.note.updateIndexStatus(note.id, 'parsing');
  jobQueue.register(new EmbedChunksJob(repositories.note, {
    version: 'edited-note-test', embed: async texts => texts.map(() => [1, ...Array<number>(767).fill(0)]),
  }, vectorStore));
  try {
    // A transient enqueue failure must not send the retry back to source-file parsing.
    await invoke('db_execute', {
      sql: "CREATE TEMP TRIGGER reject_edited_reindex BEFORE INSERT ON background_jobs WHEN NEW.job_type = 'chunk_note' BEGIN SELECT RAISE(ABORT, 'reindex enqueue fault'); END", params: [],
    });
    try { await jobQueue.drain(); }
    finally { await invoke('db_execute', { sql: 'DROP TRIGGER reject_edited_reindex', params: [] }); }
    for (let i = 0; i < 8 && (await jobQueue.listPending()).length; i++) await jobQueue.drain();
    expect(await repositories.note.findById(note.id)).toMatchObject({
      content: edited.content, contentHash: edited.contentHash, updatedAt: edited.updatedAt,
      indexStatus: 'indexed', indexError: undefined,
    });
    const chunks = await repositories.note.listChunks(note.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(edited.content);
    expect(await invoke('db_select', {
      sql: "SELECT job_type, status, retry_count FROM background_jobs WHERE entity_id = ? AND job_type = 'reindex_note'", params: [note.id],
    })).toEqual([{ job_type: 'reindex_note', status: 'completed', retry_count: 1 }]);
    expect(await invoke('db_select', {
      sql: "SELECT id FROM background_jobs WHERE entity_id = ? AND job_type = 'parse_note'", params: [note.id],
    })).toEqual([]);
    expect(await invoke('db_select', {
      sql: 'SELECT count(*) AS count FROM note_chunk_embeddings WHERE note_id = ?', params: [note.id],
    })).toEqual([{ count: 1 }]);
  } finally {
    if (embedJob) jobQueue.register(embedJob);
  }
}
