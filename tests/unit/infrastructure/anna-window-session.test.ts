import { describe, expect, it } from 'vitest';
import { acquireAnnaWindow } from '@infrastructure/anna/window-session';

describe('Anna browser window ownership', () => {
  it('keeps the browser lock until teardown and rejects a second active page', async () => {
    let held = false;
    const manager = {
      request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
        if (held) return callback(null);
        held = true;
        try { await callback({ name: 'active-window' }); }
        finally { held = false; }
      },
    } as unknown as LockManager;
    const release = await acquireAnnaWindow(manager);
    expect(held).toBe(true);
    await expect(acquireAnnaWindow(manager)).rejects.toThrow('另一个 NativeMind 页面');
    release();
    await Promise.resolve();
    await Promise.resolve();
    const nextRelease = await acquireAnnaWindow(manager);
    nextRelease();
  });

  it('does not fall back to an unguarded connection when browser locking fails', async () => {
    const manager = { request: () => Promise.reject(new Error('lock unavailable')) } as unknown as LockManager;
    await expect(acquireAnnaWindow(manager)).rejects.toThrow('lock unavailable');
  });
});
