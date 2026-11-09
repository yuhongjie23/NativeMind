import type { TauriInvoke } from '../db/tauri-driver';

export const isFileJob = (command: string): boolean =>
  ['file_read_text', 'file_extract_pdf', 'file_extract_ebook'].includes(command);

export async function runFileJob<T>(invoke: TauriInvoke, command: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const cancel = () => { void invoke('file_job_cancel', { id }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('file_job_start', { id, command, payload });
    while (true) {
      signal?.throwIfAborted();
      const update = await invoke<{ done: boolean; value?: T; error?: string }>('file_job_poll', { id });
      signal?.throwIfAborted();
      if (update.done) {
        if (update.error) throw new Error(update.error);
        return update.value as T;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}
