import { describe, expect, it, vi } from 'vitest';
import { TauriModelProvider, type TauriInvoke } from '@infrastructure/model-runtime/tauri-model-provider';
import { createDesktopInvoke } from '@infrastructure/model-runtime/desktop-invoke';

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class { onmessage?: (event: { delta: string }) => void; },
}));

function fixture() {
  let channel: { onmessage: (event: { delta: string }) => void } | undefined;
  let finish!: (value: string) => void;
  const work = new Promise<string>(resolve => { finish = resolve; });
  const commands: string[] = [];
  const raw: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
    commands.push(command);
    if (command === 'model_request_begin') return 'stream-1' as T;
    if (command === 'model_request_cancel') return true as T;
    channel = args?.on_token as typeof channel;
    return await work as T;
  };
  return {
    provider: new TauriModelProvider(createDesktopInvoke(raw)), commands, finish,
    emit: (delta: string) => { if (!channel) throw new Error('Channel not ready'); channel.onmessage({ delta }); },
  };
}

describe('desktop Channel streaming', () => {
  it('forwards cancellation to native IPC and ignores late tokens', async () => {
    const f = fixture(); const controller = new AbortController(); const onToken = vi.fn();
    const result = f.provider.complete({ model: 'fake', prompt: 'synthetic', onToken, signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.commands).toContain('model_complete_stream'));
    f.emit('first'); controller.abort(); f.emit('late'); f.finish('late answer'); await rejected;
    expect(onToken.mock.calls).toEqual([['first']]);
    expect(f.commands).toContain('model_request_cancel');
  });

  it('uses final text and stops callbacks after normal completion', async () => {
    const f = fixture(); const onToken = vi.fn();
    const result = f.provider.complete({ model: 'fake', prompt: 'synthetic', onToken });
    await vi.waitFor(() => expect(f.commands).toContain('model_complete_stream'));
    f.emit('preview'); f.finish('final answer'); expect(await result).toBe('final answer');
    f.emit('late'); expect(onToken.mock.calls).toEqual([['preview']]);
    expect(f.commands).toEqual(['model_complete_stream']);
  });

  it('does not start a pre-cancelled stream', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.provider.complete({ model: 'fake', prompt: 'synthetic', onToken: vi.fn(), signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(f.commands).toEqual([]);
  });
});
