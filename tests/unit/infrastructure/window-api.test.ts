import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canFullscreen, exitFullscreenIfActive, isWindowFullscreen, subscribeFullscreen, toggleFullscreen } from '@infrastructure/window-api';

const env = vi.hoisted(() => ({ anna: true }));
const native = vi.hoisted(() => ({
  isFullscreen: vi.fn(), setDecorations: vi.fn(), setFullscreen: vi.fn(), onResized: vi.fn(),
}));
vi.mock('@infrastructure/anna', () => ({ isAnna: () => env.anna }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }));

describe('fullscreen across runtimes', () => {
  let doc: EventTarget & { fullscreenEnabled: boolean; fullscreenElement: object | null; documentElement: { requestFullscreen: ReturnType<typeof vi.fn> }; exitFullscreen: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    env.anna = true;
    doc = Object.assign(new EventTarget(), {
      fullscreenEnabled: true, fullscreenElement: null as object | null,
      documentElement: { requestFullscreen: vi.fn(async () => { doc.fullscreenElement = {}; doc.dispatchEvent(new Event('fullscreenchange')); }) },
      exitFullscreen: vi.fn(async () => { doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); }),
    });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Anna uses browser fullscreen directly within the original gesture', async () => {
    const result = toggleFullscreen();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(await result).toBe(true);
    expect(await exitFullscreenIfActive()).toBe(true);
    expect(await exitFullscreenIfActive()).toBe(false);
    expect(native.setFullscreen).not.toHaveBeenCalled();
  });

  it('does not advertise or fake success when the host denies fullscreen', async () => {
    doc.fullscreenEnabled = false;
    expect(canFullscreen()).toBe(false);
    await expect(toggleFullscreen()).rejects.toThrow('不支持全屏');
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('treats missing browser fullscreen APIs as windowed', async () => {
    Reflect.deleteProperty(doc, 'fullscreenElement');
    doc.fullscreenEnabled = false;
    expect(await isWindowFullscreen()).toBe(false);
    expect(await exitFullscreenIfActive()).toBe(false);
  });

  it('updates on browser exits and removes listeners on disposal', async () => {
    const changed = vi.fn();
    const off = subscribeFullscreen(changed);
    await toggleFullscreen();
    expect(changed).toHaveBeenLastCalledWith(true);
    await doc.exitFullscreen();
    expect(changed).toHaveBeenLastCalledWith(false);
    off(); changed.mockClear();
    doc.dispatchEvent(new Event('fullscreenchange'));
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
  });

  it('leaves the web demo alone', async () => {
    env.anna = false;
    expect(canFullscreen()).toBe(false);
    expect(await toggleFullscreen()).toBe(false);
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('restores desktop decorations after a failed fullscreen request', async () => {
    env.anna = false;
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    native.isFullscreen.mockResolvedValue(false);
    native.setFullscreen.mockRejectedValueOnce(new Error('OS rejected'));
    await expect(toggleFullscreen()).rejects.toThrow('OS rejected');
    expect(native.setDecorations.mock.calls).toEqual([[false], [true]]);
  });
});
