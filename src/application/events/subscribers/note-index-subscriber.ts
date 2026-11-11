/**
 * 笔记索引订阅者 - 把切分/embedding 交给后台任务队列
 */
import type { JobQueuePort } from '../../ports';
import type { EventBus } from '../event-bus';

export function registerNoteIndexSubscriber(
  eventBus: EventBus,
  jobQueue: JobQueuePort
): () => void {
  // Imports already committed their first job. Edits still request a reindex here.
  return eventBus.subscribe('NoteUpdated', async (event) => {
    if (event.contentChanged && !event.indexQueued) await jobQueue.enqueue({ type: 'reindex_note', entityId: event.noteId });
  });
}
