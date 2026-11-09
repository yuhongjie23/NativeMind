import type { TauriInvoke } from '../db/tauri-driver';

export interface ModelCallOptions {
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export const isModelJob = (command: string): boolean =>
  ['model_complete', 'model_embed', 'model_is_ready', 'model_list',
    'model_is_available', 'ollama_ensure_running'].includes(command);

interface JobUpdate {
  delta: string;
  cursor: number;
  done: boolean;
  value: unknown;
  error?: string;
}

/** Callbacks and AbortSignal stay in this window; only JSON goes over the local bridge. */
export async function runModelJob<T>(
  invoke: TauriInvoke,
  command: string,
  payload: Record<string, unknown> = {},
  options: ModelCallOptions = {},
): Promise<T> {
  const { signal, onToken } = options;
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  let cursor = 0;
  const cancel = () => { void invoke('model_job_cancel', { id }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('model_job_start', { id, command, payload });
    while (true) {
      signal?.throwIfAborted();
      const update = await invoke<JobUpdate>('model_job_poll', { id, cursor });
      signal?.throwIfAborted();
      cursor = update.cursor;
      if (update.delta) onToken?.(update.delta);
      signal?.throwIfAborted();
      if (update.done) {
        if (update.error) throw new Error(update.error);
        return update.value as T;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    // Idempotent, including abort during start and transport failure. Native also has a lease.
    cancel();
  }
}
