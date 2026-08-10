/**
 * Toast 容器：右下角短暂提示，操作成功/失败时给一句轻反馈。
 */
import { useToastStore } from '../../stores/toast-store';

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            background: toast.kind === 'error' ? 'var(--danger, #9c4a3f)' : toast.kind === 'ok' ? 'var(--accent, #4a6b57)' : 'var(--surface, #fff)',
            color: toast.kind === 'error' || toast.kind === 'ok' ? '#fff' : 'var(--text, #23201c)',
            border: toast.kind === 'info' ? '1px solid var(--border, #e3e0d9)' : 'none',
            padding: '9px 16px',
            borderRadius: 12,
            fontSize: 13,
            boxShadow: '0 6px 20px rgba(0,0,0,.15)',
            animation: 'toastIn .2s ease',
          }}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
