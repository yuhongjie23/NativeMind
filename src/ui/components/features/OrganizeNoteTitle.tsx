import { useEffect, useRef, useState } from 'react';
import type { Note } from '@application/ports';
import { useT } from '../../i18n';
import { useKnowledgeOrganization } from '../../hooks/use-knowledge-organization';
import { useSettingsStore } from '../../stores/settings-store';
import { describeError, useCases } from '../../stores/runtime';
import { useNoteStore } from '../../stores/note-store';
import { useKnowledgeLinkStore } from '../../stores/knowledge-link-store';

export function OrganizeNoteTitle({ note, onSaved }: { note: Note; onSaved?: (note: Note) => void }) {
  const t = useT();
  const blocked = useKnowledgeOrganization();
  const language = useSettingsStore(state => state.language);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  const saving = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; if (!saving.current) request.current?.abort(); }; }, [note.id]);
  const generate = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage('');
    try {
      const result = await useCases.organizeNoteTitle.execute(note.id, language, { signal: controller.signal,
        onCommit: () => { saving.current = true; setCommitting(true); } });
      if (result.note) {
        await Promise.all([useNoteStore.getState().refresh(), useKnowledgeLinkStore.getState().refresh()]);
        if (live.current) onSaved?.(result.note);
      }
      if (!controller.signal.aborted) setMessage(result.status === 'insufficient'
        ? '正文不足以确定标题，请补充内容或手动命名。'
        : result.status === 'unchanged' ? '当前标题已经符合这次整理结果。'
        : result.status === 'saved' ? '改名和正文链接已一起保存。' : '已取消，原标题保留。');
    } catch (error) { if (!controller.signal.aborted) setMessage(describeError(error)); }
    finally { request.current = undefined; saving.current = false; setBusy(false); setCommitting(false); }
  };
  return <section style={{ marginBlock: 12 }} aria-label={t('AI 整理标题')}>
    <p>{t('使用 DeepSeek 阅读这篇笔记的前 6000 字符，过滤网址与导航噪声，建议内容标题。确认前不会改名。')}</p>
    {blocked && <p>{t(blocked)}</p>}
    <button type="button" className="cozy-btn-secondary" disabled={Boolean(blocked) || busy} onClick={() => void generate()}>
      {t(busy ? '正在整理标题…' : 'AI 整理标题')}
    </button>
    {busy && !committing && <button type="button" className="cozy-btn-ghost" onClick={() => request.current?.abort()}>{t('取消')}</button>}
    {message && <p role="status">{t(message)}</p>}
  </section>;
}
