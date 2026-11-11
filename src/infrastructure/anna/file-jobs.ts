import type { TauriInvoke } from '../db/tauri-driver';

export const isFileJob = (command: string): boolean =>
  ['file_read_text', 'file_extract_pdf', 'file_extract_ebook'].includes(command);

export async function runFileJob<T>(invoke: TauriInvoke, command: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const cancel = () => { void invoke('file_job_cancel', { id }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Cancellation acknowledges the request before the OS process and output
    // reader have exited. Keep the native capacity bound; briefly retry only a
    // rejected start, never a parser error or an ambiguously accepted request.
    for (let retry = 0; ; retry++) {
      signal?.throwIfAborted();
      try {
        await invoke('file_job_start', { id, command, payload });
        break;
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('FILE_JOB_BUSY:') || retry >= 20) throw error;
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      }
    }
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
