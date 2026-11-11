/**
 * 轻量错误边界：隔离子组件崩溃，不白整页；显示错误信息便于排查。
 * 挂在知识图谱等独立子视图上——子视图出问题不该让整个主界面白屏。
 */
import { Component, type ReactNode } from 'react';
import { useT } from '../../i18n';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary] 子视图崩溃:', error);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} onRetry={this.props.onRetry} />;
  }
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const t = useT();
  if (onRetry) return (
    <div className="cozy-today-empty" role="alert">
      <p>{t('这个界面暂时无法打开。请重试，或关闭后继续使用其他功能。')}</p>
      <p>{t('重试只重新打开当前界面，不会刷新整个应用；当前界面尚未保存的输入可能需要重新填写。')}</p>
      <button type="button" className="cozy-btn-secondary" onClick={onRetry}>
        {t('重试打开')}
      </button>
      <details>
        <summary>{t('查看错误详情')}</summary>
        <code className="cozy-error-boundary__message">{error.message}</code>
      </details>
    </div>
  );
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
