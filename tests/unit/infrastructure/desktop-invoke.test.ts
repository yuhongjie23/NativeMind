import { describe, expect, it, vi } from 'vitest';
import { createDesktopInvoke } from '@infrastructure/model-runtime/desktop-invoke';
import type { TauriInvoke } from '@infrastructure/model-runtime/tauri-model-provider';

function fixture() {
  const calls: string[] = [];
  let finish!: (value: unknown) => void;
  const work = new Promise(resolve => { finish = resolve; });
  const raw: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push(command);
    if (command === 'model_request_begin') return 'reservation-1' as T;
    if (command === 'model_request_cancel') { expect(args?.request_id).toBe('reservation-1'); return true as T; }
    expect(args?.request_id).toBe('reservation-1');
    return await work as T;
  };
  return { calls, finish, invoke: createDesktopInvoke(raw) };
}
describe('desktop model IPC cancellation', () => {
  it.each(['model_complete', 'model_complete_stream', 'model_embed'])('stops %s and discards a late result', async command => {
    const f = fixture(); const controller = new AbortController();
    const result = f.invoke(command, { request: {} }, { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.calls).toContain(command));
    controller.abort(); await rejected; f.finish('late');
    expect(f.calls.filter(call => call === 'model_request_cancel')).toHaveLength(1);
  });
  it('already aborted requests never invoke IPC', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.invoke('model_complete', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.calls).toEqual([]);
  });
  it('cancellation during registration releases a late reservation without starting work', async () => {
    let register!: (value: string) => void;
    const calls: string[] = [];
    const raw: TauriInvoke = async <T>(command: string) => {
      calls.push(command);
      return (command === 'model_request_begin' ? await new Promise<string>(resolve => { register = resolve; }) : true) as T;
    };
    const controller = new AbortController();
    const result = createDesktopInvoke(raw)('model_complete', {}, { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; register('late-id');
    await vi.waitFor(() => expect(calls).toEqual(['model_request_begin', 'model_request_cancel']));
  });
  it('normal completion releases the reservation', async () => {
    const f = fixture(); const controller = new AbortController();
    const result = f.invoke('model_complete', {}, { signal: controller.signal });
    f.finish('answer'); expect(await result).toBe('answer');
    controller.abort();
    expect(f.calls).toEqual(['model_request_begin', 'model_complete', 'model_request_cancel']);
  });
  it('failed IPC releases its reservation and preserves the error', async () => {
    const calls: string[] = [];
    const raw: TauriInvoke = async <T>(command: string) => {
      calls.push(command);
      if (command === 'model_request_begin') return 'failed-1' as T;
      if (command === 'model_request_cancel') return true as T;
      throw new Error('IPC failed');
    };
    await expect(createDesktopInvoke(raw)('model_embed', {}, { signal: new AbortController().signal })).rejects.toThrow('IPC failed');
    expect(calls).toEqual(['model_request_begin', 'model_embed', 'model_request_cancel']);
  });
  it('unrelated commands keep their original arguments without a reservation', async () => {
    const raw = vi.fn(async () => 42) as unknown as TauriInvoke;
    expect(await createDesktopInvoke(raw)('db_query', { sql: 'SELECT 42' }, { signal: new AbortController().signal })).toBe(42);
    expect(raw).toHaveBeenCalledExactlyOnceWith('db_query', { sql: 'SELECT 42' });
  });
});
