import { describe, expect, it, vi } from 'vitest';
import { runFileJob } from '@infrastructure/anna/file-jobs';
import type { TauriInvoke } from '@infrastructure/db/tauri-driver';

describe('Anna file jobs', () => {
  it('waits for cancelled workers to finish before retrying the same rejected start', async () => {
    vi.useFakeTimers();
    try {
      let starts = 0;
      const invoke = vi.fn().mockImplementation(async command => {
        if (command === 'file_job_start' && starts++ < 2) throw new Error('FILE_JOB_BUSY: still closing');
        if (command === 'file_job_poll') return { done: true, value: 'retry text' };
      });
      const pending = runFileJob(invoke as TauriInvoke, 'file_read_text');
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toBe('retry text');
      const ids = invoke.mock.calls.filter(([command]) => command === 'file_job_start').map(([, args]) => args.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it('bounds capacity waiting and does not retry other start failures', async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn().mockImplementation(async command => {
        if (command === 'file_job_start') throw new Error('FILE_JOB_BUSY: occupied');
      });
      const rejection = expect(runFileJob(invoke as TauriInvoke, 'file_read_text')).rejects.toThrow('FILE_JOB_BUSY');
      await vi.advanceTimersByTimeAsync(2100);
      await rejection;
      expect(invoke.mock.calls.filter(([command]) => command === 'file_job_start')).toHaveLength(21);
      invoke.mockClear().mockRejectedValue(new Error('Invalid source path'));
      await expect(runFileJob(invoke as TauriInvoke, 'file_read_text')).rejects.toThrow('Invalid source path');
      expect(invoke.mock.calls.filter(([command]) => command === 'file_job_start')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('cancels while waiting for capacity without starting a later parser', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const invoke = vi.fn().mockImplementation(async command => {
        if (command === 'file_job_start') throw new Error('FILE_JOB_BUSY: closing');
      });
      const rejection = expect(runFileJob(invoke as TauriInvoke, 'file_read_text', {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(invoke.mock.calls.filter(([command]) => command === 'file_job_start')).toHaveLength(1);
      expect(invoke.mock.calls.some(([command]) => command === 'file_job_poll')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
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
