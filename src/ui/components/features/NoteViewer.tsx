import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NotePageRange, ReadingPosition } from '@application/ports';
import { captureReadingPosition } from './reading-position';
import { findTextMatches, resolveDocumentOffset } from './document-find';
import { useT } from '../../i18n';

interface NoteViewerProps {
  content: string;
  pageRanges?: NotePageRange[];
  initialCharStart?: number;
  initialAnchor?: string;
  onReadingPosition?: (position: ReadingPosition) => void;
}


/** Two text nodes and one active mark keep long books free of per-line React nodes. */
export function NoteViewer({ content, pageRanges, initialCharStart, initialAnchor, onReadingPosition }: NoteViewerProps) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [page, setPage] = useState<number>();
  const [exactPage, setExactPage] = useState(false);
  const focusMatch = useRef(false);

  const positionedScroll = useRef<number | undefined>(undefined);
  const frame = useRef(0);
  const marker = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number; focus: boolean }>();
  const matches = useMemo(() => findTextMatches(content, search), [content, search]);
  const current = matches[active];
  const anchorOffset = useMemo(() => resolveDocumentOffset(content, initialCharStart, initialAnchor), [content, initialCharStart, initialAnchor]);

  const locate = useCallback((start: number, end: number, focus: boolean) => {
    setSelection({ start, end, focus });
  }, []);
  useEffect(() => {
    if (!selection || !marker.current || !ref.current) return;
    const id = requestAnimationFrame(() => {
      marker.current?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      if (selection.focus) ref.current?.focus({ preventScroll: true });
      positionedScroll.current = ref.current?.scrollTop;
      setPage(pageRanges?.find(range => selection.start >= range.start && selection.start < range.end)?.page);
      setExactPage(true);
    });
    return () => cancelAnimationFrame(id);
  }, [selection, pageRanges]);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query); setActive(0); }, 150);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    setSelection(undefined);
    setActive(0);
    setPage(undefined);
    positionedScroll.current = undefined;
  }, [content]);
  useEffect(() => {
    const offset = anchorOffset;
    if (offset === undefined) return;
    const id = requestAnimationFrame(() => locate(offset, Math.min(content.length, offset + Math.min(initialAnchor?.trim().length || 1, 120)), true));
    return () => cancelAnimationFrame(id);
  }, [content, anchorOffset, initialAnchor, locate]);
  useEffect(() => {
    if (open && current) locate(current.start, current.end, focusMatch.current);
    else if (open) setSelection(undefined);
  }, [current, locate, open]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const showFind = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
  }, []);
  const navigate = useCallback((direction: number) => {
    if (matches.length && query === search) {
      focusMatch.current = true;
      if (matches.length === 1) locate(matches[0].start, matches[0].end, true);
      else setActive(value => (value + direction + matches.length) % matches.length);
    }
  }, [matches, query, search, locate]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const visible = (el: HTMLElement) => el.getClientRects().length > 0;
      const viewers = Array.from(document.querySelectorAll<HTMLElement>('[data-note-viewer]')).filter(visible);
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(visible);
      const top = dialogs[dialogs.length - 1];
      if (viewers[viewers.length - 1] !== root.current || (top && !top.contains(root.current))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopImmediatePropagation(); showFind();
      } else if (open && event.key === 'F3') {
        event.preventDefault(); event.stopImmediatePropagation(); navigate(event.shiftKey ? -1 : 1);
      } else if (open && event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); setOpen(false);
        ref.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, showFind, navigate]);

  return <div ref={root} data-note-viewer>
    {initialAnchor?.trim() && anchorOffset === undefined ? (
      <p role="status">{t('当前原文中未找到这段引用，文档可能已修改。请重新检索核实。')}</p>
    ) : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      {!open ? <button type="button" className="cozy-btn-ghost" onClick={showFind}>{t('文档内查找')} (Ctrl+F)</button> : <div data-document-find style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input ref={input} aria-label={t('文档内查找')} value={query} placeholder={t('输入要查找的文字')}
          onChange={event => { focusMatch.current = false; setQuery(event.target.value); }} onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); ref.current?.focus({ preventScroll: true }); }
          }} />
        <span role="status" aria-live="polite">{query !== search ? t('正在查找…') : !search ? t('输入关键词') : matches.length ? `${active + 1} / ${matches.length}` : t('无匹配结果')}</span>
        <button type="button" className="cozy-btn-ghost" aria-label={t('上一个匹配')} disabled={!matches.length || query !== search} onClick={() => navigate(-1)}>↑</button>
        <button type="button" className="cozy-btn-ghost" aria-label={t('下一个匹配')} disabled={!matches.length || query !== search} onClick={() => navigate(1)}>↓</button>
        <button type="button" className="cozy-btn-ghost" aria-label={t('关闭文档查找')} onClick={() => setOpen(false)}>×</button>
      </div>}
    </div>
    <div style={{ position: 'relative' }}>
    <div role="textbox" aria-readonly="true" aria-multiline="true" tabIndex={0} onKeyDown={event => { if (open && event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); } }} ref={ref} aria-label={t('笔记内容')}
      onScroll={() => {
        const target = ref.current;
        if (target && positionedScroll.current !== undefined && Math.abs(target.scrollTop - positionedScroll.current) < 1) return;
        positionedScroll.current = undefined;
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const el = ref.current;
          if (!el) return;
          const readingPosition = captureReadingPosition(el, content, pageRanges);
          if (readingPosition) onReadingPosition?.(readingPosition);
          setExactPage(false);
          const offset = Math.floor(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) * content.length);
          setPage(pageRanges?.find(range => offset >= range.start && offset < range.end)?.page ?? pageRanges?.[pageRanges.length - 1]?.page);
        });
      }}
      style={{ width: '100%', height: 'clamp(160px, 32vh, 360px)', resize: 'none', overflow: 'auto', boxSizing: 'border-box', font: 'inherit', lineHeight: 1.6, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'inherit' }}>{selection ? <>{content.slice(0, selection.start)}<mark ref={marker} style={{ background: '#f4c95d', color: '#171717', font: 'inherit' }}>{content.slice(selection.start, selection.end)}</mark>{content.slice(selection.end)}</> : content}</div>
    </div>
    {pageRanges?.length ? <p className="hint">{t(exactPage ? '匹配页码' : '页码（滚动时为估算）')} {page ?? 1} / {pageRanges.length}</p> : null}
  </div>;
}
