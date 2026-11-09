import { describe, expect, it, vi } from 'vitest';
import { runFileJob } from '@infrastructure/anna/file-jobs';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';

describe('Anna file jobs', () => {
  it('returns a completed parser result and releases the job', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ done: true, value: 'text' }).mockResolvedValue(undefined);
    expect(await runFileJob(invoke as TauriInvoke, 'file_read_text', { path: 'note.txt' })).toBe('text');
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['file_job_start', 'file_job_poll', 'file_job_cancel']);
  });
  it('discards a response that arrives after cancellation', async () => {
    const controller = new AbortController();
    const invoke = vi.fn().mockImplementation(async command => {
      if (command === 'file_job_poll') { controller.abort(); return { done: true, value: 'late' }; }
    });
    await expect(runFileJob(invoke as TauriInvoke, 'file_read_text', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke.mock.calls.some(([command]) => command === 'file_job_cancel')).toBe(true);
  });
  it('releases failed parser jobs without returning empty success', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ done: true, error: 'invalid PDF' }).mockResolvedValue(undefined);
    await expect(runFileJob(invoke as TauriInvoke, 'file_extract_pdf')).rejects.toThrow('invalid PDF');
    expect(invoke.mock.calls.at(-1)?.[0]).toBe('file_job_cancel');
  });
});
