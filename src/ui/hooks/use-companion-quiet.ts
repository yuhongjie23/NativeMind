import { useEffect, useState } from 'react';
import { useCompanionStore } from '../stores/companion-store';

export function useCompanionQuiet(blocked: boolean): boolean {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    const update = () => {
      if (!mounted) return;
      const element = document.activeElement;
      setBusy(document.hidden || !!element?.closest('input, textarea, [contenteditable="true"], [role="dialog"]'));
    };
    const afterBlur = () => queueMicrotask(update);
    update();
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', afterBlur);
    document.addEventListener('visibilitychange', update);
    return () => {
      mounted = false;
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', afterBlur);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    useCompanionStore.getState().setSurfaceBusy(blocked || busy);
    return () => useCompanionStore.getState().setSurfaceBusy(true);
  }, [blocked, busy]);
  return blocked || busy;
}
