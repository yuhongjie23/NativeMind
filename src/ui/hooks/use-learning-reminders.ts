import { useEffect } from 'react';
import { eventBus } from '../stores/runtime';
import { useLearningStore } from '../stores/learning-store';

/** Persistent inbox, no modal, sound, focus stealing, or unsolicited AI generation. */
export function useLearningReminders(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const refresh = () => { void useLearningStore.getState().refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    const offs = (['FocusSessionStarted', 'FocusSessionCompleted', 'FocusSessionAborted'] as const).map(type =>
      eventBus.subscribe(type, refresh));
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); offs.forEach(off => off()); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [ready]);
}
