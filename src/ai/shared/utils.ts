/**
 * AI 层内部工具。只做纯函数，不含业务规则。
 */
import type { ISO8601DateTime } from '@shared-types/common';

export const nowIso = (): ISO8601DateTime => new Date().toISOString();

/** djb2 哈希，用于 model_runs.input_hash（只需稳定，不需要密码学强度） */
export const hashText = (text: string): string => {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `djb2:${(hash >>> 0).toString(16)}`;
};

export const hashInput = (input: unknown): string => hashText(JSON.stringify(input ?? null));

/** 渲染 {{var}} 占位符，缺失变量替换为空串（避免把 undefined 喂给模型） */
export const fillTemplate = (
  template: string,
  vars: Record<string, string | number | undefined>
): string => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));

/**
 * 从模型输出里抠出第一段 JSON。
 * 小模型常见毛病：包 ```json 代码块、前后加一句解释，这里一并容忍。
 */
export const extractJson = (raw: string): string | null => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.search(/[[{]/);
  if (start < 0) return null;

  const close = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  return end > start ? text.slice(start, end + 1) : null;
};

/** 截断长文本，避免超出模型上下文；保留结尾省略标记便于排查 */
export const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)}…（已截断）`;
