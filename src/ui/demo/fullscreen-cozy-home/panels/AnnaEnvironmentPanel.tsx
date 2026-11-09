import { useState } from 'react';
import { browserNotificationPermission, requestBrowserNotifications, sendFocusNotification } from '@infrastructure/notification-api';
import { canFullscreen } from '@infrastructure/window-api';
import { useT } from '../../../i18n';
import { useToastStore } from '../../../stores/toast-store';

export function AnnaEnvironmentPanel() {
  const t = useT();
  const [permission, setPermission] = useState(browserNotificationPermission);
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try { setPermission(await requestBrowserNotifications()); }
    finally { setBusy(false); }
  };
  const test = async () => {
    const sent = await sendFocusNotification(t('NativeMind · 提醒测试'), t('系统提醒已连接。'));
    setPermission(browserNotificationPermission());
    useToastStore.getState().show(t(sent ? '已向系统发送测试提醒' : '系统提醒不可用，专注结束时会在应用内提醒。'), 'info');
  };
  return (
    <section className="cozy-settings__group">
      <h3 className="cozy-settings__group-title">{t('Anna 运行环境')}</h3>
      <p className="cozy-settings__hint">{t(canFullscreen()
        ? '可通过顶部全屏按钮进入全屏，按 Esc 退出。'
        : '当前宿主不支持系统全屏；专注界面仍可正常使用。')}</p>
      <p className="cozy-settings__hint" role="status">{t(permission === 'granted'
        ? '已允许系统提醒。'
        : permission === 'default' ? '可开启系统提醒，在专注结束时收到通知。'
        : permission === 'denied' ? '系统提醒已被阻止，可在浏览器或宿主设置中更改。'
        : '当前环境不支持系统提醒。')}</p>
      <p className="cozy-settings__hint">{t('未收到系统通知时，回到应用仍会看到结束提醒；请保持应用打开。')}</p>
      {permission === 'default' && <button type="button" className="cozy-btn-ghost" disabled={busy} onClick={() => void enable()}>{t('开启系统提醒')}</button>}
      {permission === 'granted' && <button type="button" className="cozy-btn-ghost" onClick={() => void test()}>{t('测试系统提醒')}</button>}
    </section>
  );
}
