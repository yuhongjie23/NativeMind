import { useEffect, useRef, useState } from 'react';
import type { Note } from '@application/ports';
import type { NoteRenamePreview } from '@application/use-cases/note/rename-note';
import { describeError, eventBus, useCases } from '../../stores/runtime';
import { useNoteStore } from '../../stores/note-store';
import { useT } from '../../i18n';
import { OrganizeNoteTitle } from './OrganizeNoteTitle';

export function RenameNote({ note, onSaved }: { note: Note; onSaved?: (note: Note) => void }) {
  const t = useT();
  const [title, setTitle] = useState(note.title);
  const [preview, setPreview] = useState<NoteRenamePreview>();
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'saving' | 'undoing'>('idle');
  const [undo, setUndo] = useState(useCases.renameNote.undoAvailable(note.id));
  const [message, setMessage] = useState('');
  const ticket = useRef<string | undefined>(undefined);
  const request = useRef(0);
  const live = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    const refresh = () => setUndo(useCases.renameNote.undoAvailable(note.id));
    refresh();
    return eventBus.subscribe('NoteUpdated', refresh);
  }, [note.id]);
  useEffect(() => {
    const activeTicket = ticket;
    live.current = true; setTitle(note.title); setPreview(undefined); request.current++;
    if (ticket.current) useCases.renameNote.discard(ticket.current);
    ticket.current = undefined;
    return () => {
      live.current = false;
      const value = activeTicket.current;
      if (value) useCases.renameNote.discard(value);
    };
  }, [note.id, note.title]);

  const clear = () => {
    request.current++;
    if (ticket.current) useCases.renameNote.discard(ticket.current);
    ticket.current = undefined; setPreview(undefined);
  };
  const prepare = async () => {
    if (busy.current) return;
    busy.current = true; clear();
    const current = request.current;
    setPhase('previewing'); setMessage('');
    try {
      const value = await useCases.renameNote.preview(note.id, title);
      if (!live.current || current !== request.current) { useCases.renameNote.discard(value.ticket); return; }
      ticket.current = value.ticket; setPreview(value);
    } catch (error) { if (live.current && current === request.current) setMessage(describeError(error)); }
    finally { busy.current = false; if (live.current) setPhase('idle'); }
  };
  const save = async () => {
    if (!preview || busy.current) return;
    busy.current = true; setPhase('saving'); setMessage('');
    const value = preview.ticket;
    ticket.current = undefined;
    try {
      const saved = await useCases.renameNote.execute(value);
      await useNoteStore.getState().refresh();
      if (live.current) { onSaved?.(saved); setTitle(saved.title); setMessage('改名和正文链接已一起保存。'); }
    } catch (error) { if (live.current) setMessage(describeError(error)); }
    finally {
      busy.current = false;
      if (live.current) { setPreview(undefined); setPhase('idle'); }
    }
  };
  const undoRename = async () => {
    if (busy.current) return;
    busy.current = true; clear(); setPhase('undoing'); setMessage('');
    try {
      const restored = await useCases.renameNote.undo(note.id);
      await useNoteStore.getState().refresh();
      if (live.current) { onSaved?.(restored); setTitle(restored.title); setMessage('已撤销最近一次改名，标题和链接已恢复。'); }
    } catch (error) { if (live.current) setMessage(describeError(error)); }
    finally { busy.current = false; if (live.current) setPhase('idle'); }
  };
  return <details style={{ marginBlock: 12 }} onToggle={event => { if (!event.currentTarget.open && phase !== 'saving') clear(); }}>
    <summary style={{ cursor: 'pointer' }}>{t('修改标题与链接')}</summary>
    <OrganizeNoteTitle note={note} onSaved={onSaved} />
    <p>{t('预览后一起保存标题和正文链接。保留链接别名，不改写原文摘录、主题页历史引用或磁盘上的原文件。')}</p>
    {undo && <div>
      <p>{t('可撤销本次运行中最近一次改名：“{0}” → “{1}”。重启后此入口失效；后续修改或新增引用可能阻止撤销。', undo.oldTitle, undo.newTitle)}</p>
      <button type="button" className="cozy-btn-secondary" disabled={phase !== 'idle'} onClick={() => void undoRename()}>
        {t(phase === 'undoing' ? '正在撤销…' : '撤销最近一次改名')}
      </button>
    </div>}
    <label>{t('新标题')}
      <input value={title} maxLength={120} disabled={phase !== 'idle'}
        onChange={event => { clear(); setMessage(''); setTitle(event.target.value); }} style={{ width: '100%', boxSizing: 'border-box' }} />
    </label>
    <button type="button" className="cozy-btn-secondary" disabled={phase !== 'idle' || !title.trim() || title.trim() === note.title} onClick={() => void prepare()}>
      {t(phase === 'previewing' ? '正在预览改名…' : '预览受影响的链接')}
    </button>
    {preview && <section aria-label={t('改名预览')} style={{ overflowWrap: 'anywhere' }}>
      <p>{t('将改名为“{0}”，更新 {1} 处正文链接。', preview.newTitle, preview.linkCount)}</p>
      {preview.ambiguous && <p>{t('原标题有重名，无法判断其他笔记链接的目标。本次仅改名，不修改这些链接。')}</p>}
      {preview.notes.filter(item => item.linkCount > 0).map((item, index) => <details key={index}>
        <summary>{item.title} · {t('{0} 处链接', item.linkCount)}</summary>
        {item.samples.map((sample, i) => <div key={i}>
          <p>{t('修改前')}：<code style={{ whiteSpace: 'pre-wrap' }}>{sample.before}</code></p>
          <p>{t('修改后')}：<code style={{ whiteSpace: 'pre-wrap' }}>{sample.after}</code></p>
        </div>)}
        {item.linkCount > 3 && <p>{t('每篇最多展示 3 处示例，其余同名正文链接一起更新。')}</p>}
      </details>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBlock: 8 }}>
        <button type="button" className="cozy-btn-primary" disabled={phase !== 'idle'} onClick={() => void save()}>{t(phase === 'saving' ? '正在保存…' : '保存改名与链接')}</button>
        <button type="button" className="cozy-btn-secondary" disabled={phase !== 'idle'} onClick={clear}>{t('取消')}</button>
      </div>
    </section>}
    {message && <p role="status">{t(message)}</p>}
  </details>;
}
