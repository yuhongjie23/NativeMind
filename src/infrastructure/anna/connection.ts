import type { TauriInvoke } from '../db/tauri-driver';

export interface AnnaHost {
  windowUuid: string;
  tools: {
    invoke(args: { tool_id: string; method: string; args: Record<string, unknown> },
      options?: { timeoutMs: number }): Promise<unknown>;
  };
}

export function createAnnaConnection(host: AnnaHost, toolId: string, clientId = host.windowUuid) {
  let token: string | undefined;
  let connecting: Promise<void> | undefined;
  let closed = false;
  let closedMessage = '本页面连接已关闭，请重新打开';
  const raw = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    const response = await host.tools.invoke({ tool_id: toolId, method: 'native_command',
      args: { command, args, clientId, ...(token ? { leaseToken: token } : {}) },
    }, { timeoutMs: 300_000 });
    if (!response || typeof response !== 'object' || !('value' in response)) {
      throw new Error('Anna 本地执行程序返回了无效响应');
    }
    return (response as { value: T }).value;
  };
  const connect = async (): Promise<void> => {
    if (closed) throw new Error(closedMessage);
    if (token) return;
    connecting ??= raw<{ leaseToken: string; protocolVersion: number }>('native_connect').then(result => {
      if (!result || result.protocolVersion !== 2 || typeof result.leaseToken !== 'string' || !/^[a-f0-9]{64}$/.test(result.leaseToken)) {
        throw new Error('本地程序版本不匹配，请使用新版完整验证包并重启服务');
      }
      token = result.leaseToken;
    }).catch(error => { connecting = undefined; throw error; });
    await connecting;
  };
  const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    await connect();
    if (closed) throw new Error(closedMessage);
    try { return await raw<T>(command, args); }
    catch (error) {
      if (error instanceof Error && error.message.includes('ANNA_SESSION_EXPIRED')) {
        closed = true;
        closedMessage = error.message;
      }
      // Never retry a business command: its write may already have committed.
      throw error;
    }
  };
  const close = async (): Promise<void> => {
    closed = true;
    await connecting?.catch(() => undefined);
    if (token) await raw('native_disconnect');
  };
  return { connect, invoke, close };
}

export const createAnnaInvoke = (host: AnnaHost, toolId: string): TauriInvoke =>
  createAnnaConnection(host, toolId).invoke;
