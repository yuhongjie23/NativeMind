import { useEffect, useRef, useState } from 'react';
import type { Note } from '@application/ports';
import type { QueryNoteReferencesUseCase } from '@application/use-cases/note/query-note-references';
import { useT } from '../../i18n';
import { describeError, eventBus, repositories, useCases } from '../../stores/runtime';
import { RELATION_LABELS } from '../../stores/knowledge-link-store';

type ReferencePage = Awaited<ReturnType<QueryNoteReferencesUseCase['execute']>>;

export function NoteReferences({ noteId, onOpen }: { noteId: string; onOpen: (note: Note, start?: number, anchor?: string) => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [direction, setDirection] = useState<'incoming' | 'outgoing' | 'related'>('incoming');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ReferencePage>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const openRequest = useRef(0);
  useEffect(() => {
    active.current = true;
    openRequest.current++;
    return () => { active.current = false; };
  }, [noteId]);
  useEffect(() => {
    const refresh = () => { setOffset(0); setRevision(value => value + 1); };
    const subscriptions = ['NoteImported', 'NoteUpdated', 'NoteDeleted'] as const;
    const off = subscriptions.map(event => eventBus.subscribe(event, refresh));
    return () => off.forEach(unsubscribe => unsubscribe());
  }, []);
  useEffect(() => {
    if (!expanded) return;
    let current = true;
    setLoading(true); setMessage(''); setPage(undefined);
    void useCases.queryNoteReferences.connections(noteId, direction, offset).then(result => {
      if (current) setPage(result);
    }).catch(error => { if (current) setMessage(describeError(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [expanded, noteId, direction, offset, revision]);

  const open = async (id: string, start?: number, anchor?: string) => {
    const request = ++openRequest.current;
    try {
      const note = await repositories.note.findById(id);
      if (!active.current || request !== openRequest.current) return;
      if (!note) { setMessage('引用笔记已删除，请刷新列表。'); return; }
      onOpen(note, start, anchor);
    } catch (error) {
      if (active.current && request === openRequest.current) setMessage(describeError(error));
    }
  };

  return <details onToggle={event => setExpanded(event.currentTarget.open)} style={{ marginBlock: 12 }}>
    <summary style={{ cursor: 'pointer' }}>{t('这篇笔记的关联')}</summary>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 10 }}>
      {(['incoming', 'outgoing', 'related'] as const).map(value => <button key={value} type="button" className="cozy-btn-secondary" aria-pressed={direction === value}
        onClick={() => { setDirection(value); setOffset(0); setPage(undefined); }}>{t(value === 'incoming' ? '哪些笔记引用了这里' : value === 'outgoing' ? '引用了哪些笔记' : '相关知识')}</button>)}
    </div>
    <p>{t('显示知识卡片、主题页和正文双向链接。仅查询本地记录，不调用 AI；同名不明确的链接不计入。')}</p>
    {loading && <p role="status">{t('正在读取引用…')}</p>}
    {message && <p role="status">{t(message)}</p>}
    {page?.sourceMissing && <p role="status">{t('来源笔记已删除，以下引用保留的是历史摘录。')}</p>}
    {page?.items.length === 0 && <p>{t('这个分类下还没有关联。正文链接和已确认的引用会显示在这里。')}</p>}
    {page?.items.map((item, itemIndex) => <article key={`${item.noteId}-${itemIndex}`} style={{ border: '1px solid var(--border)', padding: 10, marginBlock: 8, borderRadius: 8, overflowWrap: 'anywhere' }}>
      <button type="button" className="cozy-link" onClick={() => void open(item.noteId, item.charStart, item.anchor)}>{item.title}</button>
      <span> · {t(item.kind === 'related' ? RELATION_LABELS[item.relationType!] : item.kind === 'card' ? '知识卡片' : item.kind === 'topic' ? '主题页' : '正文链接')}</span>
      {item.reason && <p>{item.reason}</p>}
      {item.stale && <p>{t('此引用来自旧版本或无法核对，请打开引用笔记检查。')}</p>}
      {item.quotes.map((quote, index) => <div key={index}>
        {quote.group && <h5>{quote.group}</h5>}
        {quote.reason && <p>{quote.reason}</p>}
        <blockquote style={{ whiteSpace: 'pre-wrap' }}>{quote.quote}</blockquote>
      </div>)}
    </article>)}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {offset > 0 && <button type="button" className="cozy-btn-secondary" disabled={loading} onClick={() => setOffset(value => Math.max(0, value - 20))}>{t('上一页')}</button>}
      {page?.hasMore && <button type="button" className="cozy-btn-secondary" disabled={loading} onClick={() => setOffset(value => value + 20)}>{t('下一页')}</button>}
      <button type="button" className="cozy-btn-secondary" disabled={loading} onClick={() => { setOffset(0); setRevision(value => value + 1); }}>{t('刷新引用')}</button>
    </div>
  </details>;
}
