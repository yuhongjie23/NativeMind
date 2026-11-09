/** Fullscreen is a UI capability: desktop windows or a permitted Anna document. */
import { isAnna } from './anna';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const canFullscreen = (): boolean => isTauri() || (
  isAnna() && typeof document !== 'undefined' && document.fullscreenEnabled === true &&
  typeof document.documentElement.requestFullscreen === 'function'
);

export const isWindowFullscreen = async (): Promise<boolean> => {
  if (isAnna()) return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().isFullscreen();
};

export const setWindowFullscreen = async (target: boolean): Promise<boolean> => {
  if (isAnna()) {
    if (target) {
      if (!canFullscreen()) throw new Error('当前运行环境不支持全屏');
      // Preserve the original click/key gesture: no await before requestFullscreen.
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    return Boolean(document.fullscreenElement);
  }
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (target) {
    await win.setDecorations(false);
    try { await win.setFullscreen(true); }
    catch (error) { await win.setDecorations(true); throw error; }
  } else {
    await win.setFullscreen(false);
    await win.setDecorations(true);
  }
  return target;
};

export const toggleFullscreen = async (): Promise<boolean> => {
  if (isAnna()) return setWindowFullscreen(!document.fullscreenElement);
  return setWindowFullscreen(!(await isWindowFullscreen()));
};

export const exitFullscreenIfActive = async (): Promise<boolean> => {
  if (!(await isWindowFullscreen())) return false;
  await setWindowFullscreen(false);
  return true;
};

/** Sync HUD/Escape state, including browser/OS-initiated exits. */
export const subscribeFullscreen = (onChange: (active: boolean) => void): (() => void) => {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const refresh = () => {
    void isWindowFullscreen().then((active) => { if (!disposed) onChange(active); }).catch(() => undefined);
  };
  refresh();
  if (isAnna()) {
    document.addEventListener('fullscreenchange', refresh);
    unlisten = () => document.removeEventListener('fullscreenchange', refresh);
  } else if (isTauri()) {
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const off = await getCurrentWindow().onResized(refresh);
      if (disposed) off();
      else unlisten = off;
    }).catch(() => undefined);
  }
  return () => { disposed = true; unlisten?.(); };
};
