import { createElement, lazy, Suspense, useState, type ComponentType } from 'react';
import { useT } from '../../i18n';
import { ErrorBoundary } from './ErrorBoundary';

/** Keep load stable (declare it outside the parent). Retry replaces React's cached rejected lazy instance. */
export function RetryableView<Props extends object>({ load, viewProps }: {
  load: () => Promise<{ default: ComponentType<Props> }>;
  viewProps: Props;
}) {
  const t = useT();
  const [view, setView] = useState(() => ({ component: lazy(load), attempt: 0 }));
  const retry = () => setView(previous => ({ component: lazy(load), attempt: previous.attempt + 1 }));
  return (
    <ErrorBoundary key={view.attempt} onRetry={retry}>
      <Suspense fallback={<p role="status">{t('加载中…')}</p>}>
        {createElement(view.component, viewProps)}
      </Suspense>
    </ErrorBoundary>
  );
}
