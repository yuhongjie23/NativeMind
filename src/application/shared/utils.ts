/**
 * 应用层通用工具
 */
import type { ISO8601DateTime, UUID } from '@shared-types/common';

/** 当前时间（ISO8601） */
export const now = (): ISO8601DateTime => new Date().toISOString();

/** 把 Date 转成**本地**时区的 YYYY-MM-DD。
 * 不要用 `toISOString().slice(0,10)` —— 那是 UTC 日期，东八区凌晨 0–8 点会差一天。 */
export const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** 当天日期（YYYY-MM-DD，本地时区） */
export const today = (): string => formatLocalDate(new Date());

/**
 * 判断一个 ISO8601 时间戳与参考时刻是否落在**同一个本地日**。
 * 存库的 created_at 是 UTC，用 `slice(0,10)` 和「今天」比会在东八区凌晨错位；
 * 这个方法先把时间戳转回本地再比较年月日，跨时区都正确。
 */
export const isSameLocalDay = (isoTimestamp: string, reference: Date = new Date()): boolean => {
  const instant = new Date(isoTimestamp);
  return (
    instant.getFullYear() === reference.getFullYear() &&
    instant.getMonth() === reference.getMonth() &&
    instant.getDate() === reference.getDate()
  );
};

/** 生成实体 ID */
export const newId = (): UUID => crypto.randomUUID();

/** 距某时间点的分钟数 */
export const minutesSince = (timestamp: ISO8601DateTime): number =>
  (Date.now() - new Date(timestamp).getTime()) / 60000;

export interface PlainParagraph {
  /** 段落在原文本中的字符起始偏移（UI 定位用） */
  charStart: number;
  text: string;
}

/**
 * 把纯文本按段落切成块（无标题结构时用，如 PDF/兜底搜索）。
 *
 * 用于两处：web 演示模式的 LocalNoteSearchPort，和桌面端向量检索无命中时的
 * 关键词兜底——让它们也返回「段落级」结果而不是整条笔记，用户才能定位到
 * 具体哪一段命中。切法与 ai/rag/chunk-strategy 的 chunkPlainText 语义一致：
 * 按空行分段、单段超长时硬切、过短段落与相邻段合并。
 */
export function splitPlainIntoParagraphs(
  text: string,
  targetChars = 800,
  maxChars = 1500,
  minChars = 200
): PlainParagraph[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: PlainParagraph[] = [];

  let current: string[] = [];
  let currentLen = 0;
  let cursor = 0;
  let chunkStart = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ charStart: chunkStart, text: current.join('\n\n') });
    current = [];
    currentLen = 0;
  };

  for (const paragraph of paragraphs) {
    const start = text.indexOf(paragraph, cursor);
    const index = start >= 0 ? start : cursor;

    // 单段就超上限：硬切，避免巨型段拖慢检索
    if (paragraph.length > maxChars) {
      flush();
      for (let i = 0; i < paragraph.length; i += targetChars) {
        chunks.push({
          charStart: index + i,
          text: paragraph.slice(i, i + targetChars),
        });
      }
      cursor = index + paragraph.length + 2;
      chunkStart = cursor;
      continue;
    }

    if (current.length === 0) chunkStart = index;
    current.push(paragraph);
    currentLen += paragraph.length;
    cursor = index + paragraph.length + 2;

    if (currentLen >= targetChars) flush();
  }
  flush();

  // 过短块与前一合并，减少碎片
  const merged: PlainParagraph[] = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && chunk.text.length < minChars && prev.text.length < maxChars) {
      prev.text = `${prev.text}\n\n${chunk.text}`;
    } else {
      merged.push({ ...chunk });
    }
  }
  return merged;
}
