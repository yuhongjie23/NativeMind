import type { KnowledgeProgress } from '@application/ports';

/** Timings describe work duration, including a failed stage's fallback wait. */
export async function measureKnowledgeStage<T>(
  stage: KnowledgeProgress['stage'],
  observer: ((progress: KnowledgeProgress) => void) | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  observer?.({ stage, state: 'running' });
  try { return await work(); }
  finally { observer?.({ stage, state: 'finished', durationMs: performance.now() - start }); }
}
