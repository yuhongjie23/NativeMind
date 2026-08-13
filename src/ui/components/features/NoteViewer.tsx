/**
 * 长文查看器
 *
 * 正文动辄几十万字（PDF/电子书），用 `<pre>` 渲染会一次性铺几十万个 DOM 节点，
 * 浏览器直接卡死。改用只读 textarea：浏览器原生优化大文本滚动，单个元素扛得住。
 * `defaultValue` 只在挂载时设一次，滚动重渲染不会反复 diff 那串大字符串。
 *
 * PDF 导入的笔记带 pageRanges（页 → 字符区间），按滚动进度估算当前页码。
 *
 * 段落定位（检索命中打开）：
 *   - 优先用 initialAnchor（命中段落文本）在正文里 indexOf 精确定位，
 *     比 charStart 抗漂移（合并父块/切块偏移都可能让 charStart 略偏）；
 *   - 定位滚动不靠「字符比例 × 高度」的线性估算——pre-wrap 下中英文混排
 *     每行字符数不均，长文里线性估算会累积误差。改用与 textarea 同样式的
 *     隐藏测量元素量出 content.slice(0, offset) 的真实高度作为 scrollTop，
 *     精度到行。
 */
import { useEffect, useRef, useState } from 'react';
import type { NotePageRange } from '@application/ports';

interface NoteViewerProps {
  content: string;
  pageRanges?: NotePageRange[];
  /** 打开时定位到的字符偏移（检索命中段落），无则从头部开始 */
  initialCharStart?: number;
  /** 命中段落文本：优先用它在正文里 indexOf 精确定位 */
  initialAnchor?: string;
}

/** 取命中段落在正文里的真实偏移：优先文本锚定，回退 charStart */
function resolveOffset(content: string, charStart?: number, anchor?: string): number | undefined {
  const probe = anchor?.slice(0, 120).trim();

  if (probe) {
    // 优先在 charStart 附近 ±1500 字符窗口内找 anchor 开头——命中段一定在这附近，
    // 避免全文 indexOf 撞上正文里「同样开头但更靠前」的句子（如前言引用）
    if (charStart !== undefined) {
      const from = Math.max(0, charStart - 1500);
      const to = Math.min(content.length, charStart + probe.length + 1500);
      const windowIndex = content.indexOf(probe, from);
      if (windowIndex >= 0 && windowIndex + probe.length <= to) return windowIndex;
    }
    const index = content.indexOf(probe);
    if (index >= 0) return index;
  }

  if (charStart !== undefined && charStart >= 0 && charStart < content.length) return charStart;
  return undefined;
}

export function NoteViewer({ content, pageRanges, initialCharStart, initialAnchor }: NoteViewerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // 滚动时触发一次重渲染以刷新页码标签；textarea 用 defaultValue，重渲染不碰正文
  const [, bump] = useState(0);

  // 段落定位：文本锚定优先 → 测量元素精确滚动
  useEffect(() => {
    const offset = resolveOffset(content, initialCharStart, initialAnchor);
    if (offset === undefined) return;
    const el = ref.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;

    // 等 Modal 挂载 + textarea 布局完成（否则 clientWidth/scrollHeight 不准）
    requestAnimationFrame(() => {
      const target = ref.current;
      if (!target) return;
      const width = target.clientWidth;
      const styles = window.getComputedStyle(target);

      // 隐藏测量层：与 textarea 同样式、同宽，量出前缀文本的真实高度
      const measure = document.createElement('div');
      measure.style.cssText = [
        'position:fixed',
        'left:-10000px',
        'top:0',
        `width:${width}px`,
        `font:${styles.font}`,
        `font-size:${styles.fontSize}`,
        `line-height:${styles.lineHeight}`,
        `padding:${styles.padding}`,
        'box-sizing:border-box',
        `white-space:${styles.whiteSpace}`,
        `word-break:${styles.wordBreak}`,
        'overflow:hidden',
        'visibility:hidden',
        'pointer-events:none',
      ].join(';');
      measure.textContent = content.slice(0, offset);
      document.body.appendChild(measure);

      const scrollTop = Math.min(measure.scrollHeight, target.scrollHeight - target.clientHeight);
      document.body.removeChild(measure);

      target.scrollTop = scrollTop;
      bump((n) => n + 1);
    });
    // 只定位一次；后续滚动由用户接管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCharStart, initialAnchor]);

  const pageLabel = (() => {
    const el = ref.current;
    if (!el || !pageRanges || pageRanges.length === 0) return '';
    if (el.scrollHeight <= el.clientHeight) return `共 ${pageRanges.length} 页`;
    const fraction = el.scrollTop / (el.scrollHeight - el.clientHeight);
    // 按滚动进度估算字符偏移（近似；wrap 行高不一，作定位提示够用）
    const offset = Math.floor(fraction * content.length);
    const page =
      pageRanges.find((range) => offset >= range.start && offset <= range.end)?.page ??
      pageRanges[pageRanges.length - 1].page;
    return `第 ${page} 页 / 共 ${pageRanges.length} 页`;
  })();

  return (
    <div>
      <textarea
        ref={ref}
        aria-label="笔记内容"
        defaultValue={content}
        onScroll={() => bump((n) => n + 1)}
        readOnly
        spellCheck={false}
        style={{
          width: '100%',
          height: '60vh',
          resize: 'none',
          overflow: 'auto',
          boxSizing: 'border-box',
          font: 'inherit',
          lineHeight: 1.6,
          padding: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'inherit',
        }}
      />
      {pageRanges && pageRanges.length > 0 ? (
        <p className="hint" role="status">
          {pageLabel}
        </p>
      ) : null}
    </div>
  );
}
