import { expect } from 'vitest';
import type { TauriRuntime } from '@infrastructure/tauri-runtime';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';

export async function verifyImportTransactions(runtime: TauriRuntime, invoke: TauriInvoke): Promise<void> {
  const source = { kind: 'text', content: 'transactional import retry', title: 'rollback fixture' } as const;
  const importNote = runtime.application.useCases.importNote;
  const notifications: string[] = [];
  const off = runtime.application.eventBus.subscribe('NoteImported', event => { notifications.push(event.noteId); });
  try {
    await invoke('db_execute', {
      sql: "CREATE TEMP TRIGGER reject_index BEFORE INSERT ON background_jobs WHEN NEW.job_type = 'chunk_note' BEGIN SELECT RAISE(ABORT, 'index enqueue fault'); END",
      params: [],
    });
    try {
      await expect(importNote.execute(source)).rejects.toThrow('index enqueue fault');
      expect(await invoke('db_select', { sql: 'SELECT id FROM notes WHERE content = ?', params: [source.content] })).toEqual([]);
      expect(notifications).toEqual([]);
    } finally {
      await invoke('db_execute', { sql: 'DROP TRIGGER reject_index', params: [] });
    }
    let duplicates = 0;
    const options = { onDuplicate: () => { duplicates++; } };
    const [a, b] = await Promise.all([importNote.execute(source, options), importNote.execute(source, options)]);
    expect(a.id).toBe(b.id);
    expect(duplicates).toBe(1);
    expect(notifications).toEqual([a.id]);
    expect(await invoke('db_select', { sql: 'SELECT id FROM notes WHERE content = ?', params: [source.content] })).toEqual([{ id: a.id }]);
    expect(await invoke('db_select', { sql: 'SELECT job_type, status FROM background_jobs WHERE entity_id = ?', params: [a.id] }))
      .toEqual([{ job_type: 'chunk_note', status: 'pending' }]);
  } finally { off(); }
}
