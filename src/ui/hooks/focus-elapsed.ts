/** Notify once on a live countdown reaching zero, never for an already-expired session. */
export const createFocusElapsedSignal = (): ((remaining: number) => boolean) => {
  let initialized = false;
  let finished = false;
  return (remaining) => {
    if (!initialized) {
      initialized = true;
      finished = remaining === 0;
      return false;
    }
    if (finished || remaining > 0) return false;
    finished = true;
    return true;
  };
};
