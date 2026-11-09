import { expect, it, vi } from 'vitest';
import { createLocalDemoRuntime } from '@infrastructure/local-demo';

it('keeps a single note and index job when imports race and a post-commit subscriber throws', async () => {
  const runtime = createLocalDemoRuntime();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const observed = vi.fn();
  try {
    runtime.application.eventBus.subscribe('NoteImported', () => { throw new Error('observer failure'); });
    runtime.application.eventBus.subscribe('NoteImported', observed);
    const source = { kind: 'text', content: 'same demo note' } as const;
    const results = await Promise.all([1, 2].map(() => runtime.application.useCases.importNote.execute(source)));
    expect(results[0].id).toBe(results[1].id);
    expect(await runtime.repositories.note.listAll()).toHaveLength(1);
    expect(await runtime.infrastructure.jobQueue.listAll()).toEqual([{ type: 'chunk_note', entityId: results[0].id }]);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledOnce();
  } finally {
    runtime.application.dispose();
    errors.mockRestore();
  }
});
