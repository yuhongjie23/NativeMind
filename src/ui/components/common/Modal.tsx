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
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !dismissible || !onClose) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  // 焦点陷阱：打开时聚焦弹窗内首个可聚焦元素；Tab 循环困在弹窗内；关闭后还原焦点
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.hasAttribute('disabled')
          )
        : [];

    const first = focusables()[0] ?? dialog;
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === firstEl || activeEl === dialog)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && activeEl === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={dismissible ? onClose : undefined}>
      <div
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="modal-title" id={titleId}>
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
