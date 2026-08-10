/**
 * 长文查看器
 *
 * 正文动辄几十万字（PDF/电子书），用 `<pre>` 渲染会一次性铺几十万个 DOM 节点，
 * 浏览器直接卡死。改用只读 textarea：浏览器原生优化大文本滚动，单个元素扛得住。
 * `defaultValue` 只在挂载时设一次，滚动重渲染不会反复 diff 那串大字符串。
 *
 * PDF 导入的笔记带 pageRanges（页 → 字符区间），按滚动进度估算当前页码。
 */
import { useRef, useState } from 'react';
import type { NotePageRange } from '@application/ports';

interface NoteViewerProps {
  content: string;
  pageRanges?: NotePageRange[];
}

export function NoteViewer({ content, pageRanges }: NoteViewerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // 滚动时触发一次重渲染以刷新页码标签；textarea 用 defaultValue，重渲染不碰正文
  const [, bump] = useState(0);

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
