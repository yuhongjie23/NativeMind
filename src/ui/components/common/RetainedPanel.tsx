import { Suspense, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { ErrorBoundary } from './ErrorBoundary';

/** Mount on first open, then keep drafts and ongoing work alive while hidden. */
export function RetainedPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState(active);
  const t = useT();
  if (active && !opened) setOpened(true);

  return (
    <div hidden={!active}>
      {opened || active ? (
        <ErrorBoundary>
          <Suspense fallback={<p role="status">{t('加载中…')}</p>}>
            {children}
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </div>
  );
}
