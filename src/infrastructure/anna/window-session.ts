import { createAnnaConnection, type AnnaHost } from './connection';

/** A real browser lock survives timer throttling and is released by document teardown. */
export function acquireAnnaWindow(locks: LockManager): Promise<() => void> {
  return new Promise((resolve, reject) => {
    void locks.request('nativemind:anna:active-window', { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('另一个 NativeMind 页面仍在打开，请先关闭它，再点击重试连接。')); return; }
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}

export async function connectAnnaWindow(host: AnnaHost, onWaiting: () => void) {
  if (!navigator.locks) throw new Error('当前浏览器不支持安全的窗口连接，请使用新版 Edge 或 Chrome。');
  const unlock = await acquireAnnaWindow(navigator.locks);
  const connection = createAnnaConnection(host, 'tool-dev-nativemind', `${host.windowUuid}:${crypto.randomUUID()}`);
  let leaving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    leaving = true;
    clearTimeout(timer);
    window.removeEventListener('pagehide', close);
    // pagehide delivery is best effort; the native 15-second lease is the fallback.
    void connection.close().catch(() => undefined);
    unlock();
  };
  window.addEventListener('pagehide', close);
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (leaving) throw new Error('页面已关闭');
      try { await connection.connect(); break; }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('ANNA_WINDOW_BUSY') || Date.now() >= deadline) throw error;
        onWaiting();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (leaving) throw new Error('页面已关闭');
    const heartbeat = async () => {
      if (leaving) return;
      try { await connection.invoke('native_heartbeat'); }
      catch (error) {
        if (error instanceof Error && error.message.includes('ANNA_SESSION_EXPIRED')) {
          close();
          const notice = document.createElement('div');
          notice.setAttribute('role', 'alert');
          notice.className = 'anna-session-notice';
          notice.textContent = '本页面连接已失效，请关闭其他 NativeMind 页面后重新打开。当前未提交的输入仍显示在页面中。';
          document.body.append(notice);
          return;
        }
      }
      if (!leaving) timer = setTimeout(() => { void heartbeat(); }, 3000);
    };
    timer = setTimeout(() => { void heartbeat(); }, 3000);
    return { invoke: connection.invoke, close };
  } catch (error) { close(); throw error; }
}
