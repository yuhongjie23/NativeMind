/**
 * 轻量错误边界：隔离子组件崩溃，不白整页；显示错误信息便于排查。
 * 挂在知识图谱等独立子视图上——子视图出问题不该让整个主界面白屏。
 */
import { Component, type ReactNode } from 'react';
import { useT } from '../../i18n';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary] 子视图崩溃:', error);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} />;
  }
}

function ErrorFallback({ error }: { error: Error }) {
  const t = useT();
  return (
    <div className="cozy-today-empty">
      <p>{t('这个视图出错了，错误信息：')}</p>
      <code className="cozy-error-boundary__message">{error.message}</code>
      <button
        type="button"
        className="cozy-btn-secondary"
        onClick={() => location.reload()}
        style={{ marginTop: 12 }}
      >
        {t('刷新页面')}
      </button>
    </div>
  );
}
