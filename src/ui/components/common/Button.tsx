/**
 * 按钮
 *
 * 三个变体够用：主操作、次要操作、幽灵按钮。样式类名走 globals.css，
 * 不引组件库 —— 现阶段的界面复杂度撑不起那份依赖。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({ variant = 'secondary', className, children, ...rest }: ButtonProps) {
  return (
    <button className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}
