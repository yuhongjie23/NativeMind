/**
 * 轻量 i18n：中文为源语言，英文由覆盖表提供。
 *
 * 用法（组件里）：
 *   const t = useT();
 *   t('今天'); t('专注 {0} 分钟', 25);
 *
 * 覆盖表 key 用中文原文（含 {n} 占位符），value 为英文；无映射回退中文。
 * 语言存在 settings-store（app.language），切换即持久化、全局生效。
 */
import type { AppLanguage } from '@shared-types/config';
import { useSettingsStore } from '../stores/settings-store';
import { EN } from './en';

export type { AppLanguage };

/** 英文覆盖表。key = 中文原文（含 {n} 占位符），value = 英文 */
export const addEn = (entries: Record<string, string>): void => {
  Object.assign(EN, entries);
};

const render = (language: AppLanguage, key: string, args: (string | number)[]): string => {
  let text = language === 'en' ? (EN[key] ?? key) : key;
  args.forEach((arg, index) => {
    text = text.split(`{${index}}`).join(String(arg));
  });
  return text;
};

/** 非组件场景用（toast / 订阅者等）：读当前语言即时渲染 */
export const t = (key: string, ...args: (string | number)[]): string =>
  render(useSettingsStore.getState().language, key, args);

/** 组件内用：订阅语言变化，切换时自动重渲染 */
export const useT = (): ((key: string, ...args: (string | number)[]) => string) => {
  const language = useSettingsStore((state) => state.language);
  return (key, ...args) => render(language, key, args);
};
