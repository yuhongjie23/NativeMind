import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserNotificationPermission, requestBrowserNotifications, sendFocusNotification } from '@infrastructure/notification-api';

const env = vi.hoisted(() => ({ anna: true }));
const desktop = vi.hoisted(() => ({ isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn() }));
vi.mock('@infrastructure/anna', () => ({ isAnna: () => env.anna }));
vi.mock('@tauri-apps/plugin-notification', () => desktop);

describe('focus notifications', () => {
  const sent = vi.fn();
  const request = vi.fn();
  let permission: NotificationPermission;
  beforeEach(() => {
    vi.clearAllMocks(); env.anna = true; permission = 'default';
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('Notification', class {
      static get permission() { return permission; }
      static requestPermission = request;
      constructor(title: string, options: NotificationOptions) { sent(title, options); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('never prompts for permission when the countdown ends', async () => {
    expect(await sendFocusNotification('title', 'body')).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(desktop.sendNotification).not.toHaveBeenCalled();
  });
  it('requests only from the explicit enable action', async () => {
    request.mockResolvedValueOnce('granted');
    expect(await requestBrowserNotifications()).toBe('granted');
    permission = 'denied';
    expect(await requestBrowserNotifications()).toBe('denied');
    expect(request).toHaveBeenCalledOnce();
  });
  it('sends an allowed Anna notification without using Tauri', async () => {
    permission = 'granted';
    expect(await sendFocusNotification('title', 'body')).toBe(true);
    expect(sent).toHaveBeenCalledWith('title', { body: 'body', tag: 'nativemind-focus-finished' });
    expect(desktop.isPermissionGranted).not.toHaveBeenCalled();
  });
  it('returns a fallback signal when the container rejects notifications', async () => {
    permission = 'granted';
    sent.mockImplementationOnce(() => { throw new Error('unsupported container'); });
    expect(await sendFocusNotification('title', 'body')).toBe(false);
  });
  it('does not prompt in an insecure or unsupported container', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    expect(browserNotificationPermission()).toBe('unsupported');
    expect(await requestBrowserNotifications()).toBe('unsupported');
    expect(request).not.toHaveBeenCalled();
  });
  it('does not offer permission prompts in cross-origin frames', async () => {
    vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://app.example' }, top: {
      get location() { throw new Error('cross-origin access denied'); },
    } });
    expect(browserNotificationPermission()).toBe('unsupported');
    expect(await requestBrowserNotifications()).toBe('unsupported');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps the desktop notification path', async () => {
    env.anna = false;
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    desktop.isPermissionGranted.mockResolvedValue(true);
    expect(await sendFocusNotification('title', 'body')).toBe(true);
    expect(desktop.sendNotification).toHaveBeenCalledWith({ title: 'title', body: 'body' });
    expect(sent).not.toHaveBeenCalled();
  });
});
