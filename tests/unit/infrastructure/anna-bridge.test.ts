import { describe, expect, it, vi } from 'vitest';
import { createAnnaInvoke, type AnnaHost } from '@infrastructure/anna';
import { TauriModelProvider } from '@infrastructure/model-runtime/tauri-model-provider';
import { createAnnaConnection } from '@infrastructure/anna/connection';

const lease = { leaseToken: 'a'.repeat(64), protocolVersion: 2 };
const respondingHost = (value: unknown): AnnaHost => ({ windowUuid: 'w', tools: {
  invoke: async ({ args }) => ({ value: args.command === 'native_connect' ? lease : value }),
} });

describe('Anna desktop transport', () => {
  it('carries window identity and returns the actual native result', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ value: lease }).mockResolvedValue({ value: [{ title: '真实任务' }] });
    const bridge = createAnnaInvoke({ windowUuid: 'window-1', tools: { invoke } }, 'native-tool');
    expect(await bridge('db_select', { sql: 'SELECT title FROM todos' })).toEqual([{ title: '真实任务' }]);
    expect(invoke.mock.calls[1][0]).toEqual({ tool_id: 'native-tool', method: 'native_command', args: {
      clientId: 'window-1', leaseToken: lease.leaseToken, command: 'db_select', args: { sql: 'SELECT title FROM todos' },
    } });
  });

  it('does not report a failed native write as saved', async () => {
    const host: AnnaHost = { windowUuid: 'w', tools: { invoke: async ({ args }) => {
      if (args.command === 'native_connect') return { value: lease };
      throw new Error('disk full');
    } } };
    await expect(createAnnaInvoke(host, 'tool')('db_execute')).rejects.toThrow('disk full');
  });

  it.each([[], false, 0, null])('preserves native scalar and array results: %j', async (value) => {
    const host = respondingHost(value);
    expect(await createAnnaInvoke(host, 'tool')('native_status')).toEqual(value);
  });

  it('rejects a malformed host result instead of passing {} to repositories', async () => {
    const host: AnnaHost = { windowUuid: 'w', tools: { invoke: async () => ({}) } };
    await expect(createAnnaInvoke(host, 'tool')('db_select')).rejects.toThrow('无效响应');
  });

  it('uses actual completion without requiring Tauri Channel in Anna', async () => {
    const invoke = vi.fn().mockResolvedValue('实际模型输出');
    const provider = new TauriModelProvider(invoke, { streaming: false });
    const onToken = vi.fn();
    expect(await provider.complete({ model: 'local-model', prompt: '学习计划', onToken })).toBe('实际模型输出');
    expect(invoke.mock.calls[0][0]).toBe('model_complete');
    expect(onToken).toHaveBeenCalledWith('实际模型输出');
  });

  it('shares a pending handshake and never silently reconnects a revoked writer', async () => {
    const calls: string[] = [];
    const connection = createAnnaConnection({ windowUuid: 'w', tools: { invoke: async ({ args }) => {
      calls.push(String(args.command));
      if (args.command === 'native_connect') return { value: lease };
      throw new Error('ANNA_SESSION_EXPIRED');
    } } }, 'tool');
    await Promise.all([connection.connect(), connection.connect()]);
    await expect(connection.invoke('db_execute')).rejects.toThrow('ANNA_SESSION_EXPIRED');
    await expect(connection.invoke('db_execute')).rejects.toThrow('ANNA_SESSION_EXPIRED');
    expect(calls).toEqual(['native_connect', 'db_execute']);
  });

  it('can retry a busy handshake without retrying a business write', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('ANNA_WINDOW_BUSY'))
      .mockResolvedValueOnce({ value: lease }).mockRejectedValue(new Error('lost response'));
    const connection = createAnnaConnection({ windowUuid: 'w', tools: { invoke } }, 'tool');
    await expect(connection.connect()).rejects.toThrow('ANNA_WINDOW_BUSY');
    await connection.connect();
    await expect(connection.invoke('db_execute')).rejects.toThrow('lost response');
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('releases a handshake that completed after its page was closed', async () => {
    let finish!: (value: unknown) => void;
    const invoke = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ value: { ok: true } });
    const connection = createAnnaConnection({ windowUuid: 'w', tools: { invoke } }, 'tool');
    const write = connection.invoke('db_execute');
    const closed = connection.close();
    finish({ value: lease });
    await expect(write).rejects.toThrow('已关闭');
    await closed;
    expect(invoke.mock.calls.map(call => call[0].args.command)).toEqual(['native_connect', 'native_disconnect']);
  });

  it.each([{ leaseToken: '1' }, { ...lease, protocolVersion: 1 }, { ...lease, leaseToken: '' }])('拒绝旧版/无效凭据，业务命令不发送', async value => {
    const invoke = vi.fn().mockResolvedValue({ value });
    await expect(createAnnaInvoke({ windowUuid: 'w', tools: { invoke } }, 'tool')('db_execute')).rejects.toThrow('版本不匹配');
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0][0].args.command).toBe('native_connect');
  });
});
