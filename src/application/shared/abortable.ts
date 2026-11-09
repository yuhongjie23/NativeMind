/** Stop awaiting an operation even if an older port implementation ignores cancellation. */
export async function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  let cancel: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => reject(signal?.reason);
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
    });
    return await Promise.race([work, interrupted]);
  } finally {
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}
