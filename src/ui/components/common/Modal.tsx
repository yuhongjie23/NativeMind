/**
 * 模态框
 *
 * role="dialog" + aria-modal + aria-labelledby 指向标题，读屏时能正确播报。
 * Esc 关闭；点遮罩关闭只在 dismissible 时开启 —— 确认弹窗必须显式选择，
 * 手滑点到外面不该算作默认同意或拒绝。
 *
 * 焦点陷阱：打开时把焦点移进弹窗，Tab/Shift+Tab 困在弹窗内循环（不逃逸到
 * 背景页面），关闭后焦点还给之前聚焦的元素 —— 对 dismissible={false} 的
 * 删除确认框同样生效，不能被 Tab 绕过。
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 允许 Esc 与点遮罩关闭 */
  dismissible?: boolean;
  onClose?: () => void;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, children, footer, dismissible = true, onClose }: ModalProps) {
  const t = useT();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isTopDialog = () => {
    const dialogs = document.querySelectorAll('.modal-overlay > .modal');
    return dialogs[dialogs.length - 1] === dialogRef.current;
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopDialog()) return;
      if (event.target instanceof Element && event.target.closest('[data-note-viewer]')?.querySelector('[data-document-find]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (dismissible) onClose?.();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, dismissible, onClose]);

  // 焦点陷阱：打开时聚焦弹窗内首个可聚焦元素；Tab 循环困在弹窗内；关闭后还原焦点
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0
          )
        : [];

    const first = focusables()[0] ?? dialog;
    first?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog || !isTopDialog()) return;
      // The sheet beneath this dialog has its own focus trap.
      event.stopImmediatePropagation();
      const list = focusables();
      if (list.length === 0) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === firstEl || !dialog.contains(activeEl) || activeEl === dialog)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (activeEl === lastEl || !dialog.contains(activeEl) || activeEl === dialog)) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  // Keep scene theme inheritance, but escape the transformed, scrollable sheet.
  const host = document.querySelector('[data-modal-root]') ?? document.body;
  return createPortal(
    <div className="modal-overlay" onClick={(event) => {
      event.stopPropagation();
      if (dismissible && event.target === event.currentTarget && isTopDialog()) onClose?.();
    }}>
      <div
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 className="modal-title" id={titleId}>{title}</h2>
          {dismissible && onClose && <button type="button" className="modal-close" aria-label={t('关闭')} onClick={onClose}>×</button>}
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    host
  );
}
