/** A timeout ends the underlying model request as well as the caller's wait. */
export async function withModelDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  parent?: AbortSignal,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`${label}超时`)), ms);
  let rejectOnAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    return await Promise.race([work(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}
