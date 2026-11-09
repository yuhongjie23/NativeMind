import { isAnna } from './anna';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

/** Permission requests belong to an explicit settings click, never the timer. */
export const browserNotificationPermission = (): BrowserNotificationPermission => {
  if (!isAnna() || typeof window === 'undefined' || !window.isSecureContext ||
      typeof Notification === 'undefined') return 'unsupported';
  try {
    // Browsers block notification permission prompts from cross-origin frames.
    if (window.top && window.top !== window && window.top.location.origin !== window.location.origin) {
      return 'unsupported';
    }
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
};

export const requestBrowserNotifications = async (): Promise<BrowserNotificationPermission> => {
  const permission = browserNotificationPermission();
  if (permission !== 'default') return permission;
  try { return await Notification.requestPermission(); }
  catch { return 'unsupported'; }
};

/** False means the UI must still provide an in-app reminder. No Tauri calls in Anna. */
export const sendFocusNotification = async (title: string, body: string): Promise<boolean> => {
  try {
    if (isAnna()) {
      if (browserNotificationPermission() !== 'granted') return false;
      new Notification(title, { body, tag: 'nativemind-focus-finished' });
      return true;
    }
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
    const notifications = await import('@tauri-apps/plugin-notification');
    const granted = await notifications.isPermissionGranted() ||
      (await notifications.requestPermission()) === 'granted';
    if (!granted) return false;
    notifications.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
};
