/**
 * 笔记索引订阅者 - 把切分/embedding 交给后台任务队列
 */
import type { JobQueuePort } from '../../ports';
import type { EventBus } from '../event-bus';

export function registerNoteIndexSubscriber(
  eventBus: EventBus,
  jobQueue: JobQueuePort
): () => void {
  const unsubscribes = [
    eventBus.subscribe('NoteImported', async (event) => {
      await jobQueue.enqueue({ type: 'parse_note', entityId: event.noteId });
    }),

    eventBus.subscribe('NoteUpdated', async (event) => {
      if (!event.contentChanged) return;
      await jobQueue.enqueue({ type: 'reindex_note', entityId: event.noteId });
    }),
  ];

  return () => unsubscribes.forEach((off) => off());
}
