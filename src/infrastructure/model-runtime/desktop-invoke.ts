import { abortable } from '@application/shared/abortable';
import type { TauriInvoke } from './tauri-model-provider';

const MODEL_COMMANDS = new Set(['model_complete', 'model_complete_stream', 'model_embed']);

/** Register before starting so cancellation cannot overtake an unknown native job. */
export function createDesktopInvoke(raw: TauriInvoke): TauriInvoke {
  return async <T>(command: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<T> => {
    const signal = options?.signal;
    signal?.throwIfAborted();
    if (!signal || !MODEL_COMMANDS.has(command)) return raw<T>(command, args);
    const release = (id: string): Promise<void> => raw('model_request_cancel', { request_id: id }).then(() => undefined)
      .catch(error => { console.warn('[model] 请求清理失败', error); });
    const registering = raw<string>('model_request_begin').then(id => {
      if (signal.aborted) void release(id);
      return id;
    });
    const id = await abortable(registering, signal);
    let cancelled = false;
    const cancel = (): void => { if (!cancelled) { cancelled = true; void release(id); } };
    try {
      signal.addEventListener('abort', cancel, { once: true });
      signal.throwIfAborted();
      const result = await abortable(raw<T>(command, { ...args, request_id: id }), signal);
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
      cancel(); // Also frees a reservation if invocation failed before reaching Rust.
    }
  };
}
