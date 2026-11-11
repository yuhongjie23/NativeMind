import { useEffect, useRef, useState } from 'react';
import type { Note } from '@application/ports';
import { MAX_STANDARD_NOTE_CHARS } from '@application/use-cases/note/standardize-note';
import { useT } from '../../i18n';
import { useKnowledgeOrganization } from '../../hooks/use-knowledge-organization';
import { useSettingsStore } from '../../stores/settings-store';
import { describeError, useCases } from '../../stores/runtime';
import { useNoteStore } from '../../stores/note-store';
import { useKnowledgeLinkStore } from '../../stores/knowledge-link-store';

export function StandardizeNote({ note, onOpen }: { note: Note; onOpen: (note: Note) => void }) {
  const t = useT();
  const blocked = useKnowledgeOrganization();
  const language = useSettingsStore(state => state.language);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<Note>();
  const request = useRef<{ controller: AbortController; saving: boolean } | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    // Keep the ref containers: cleanup must cancel the latest request, not the one at mount.
    const lifecycle = generation;
    const pending = request;
    const token = ++lifecycle.current;
    setPhase('idle'); setMessage(''); setSaved(undefined);
    return () => { if (lifecycle.current === token) lifecycle.current++; if (!pending.current?.saving) pending.current?.controller.abort(); };
  }, [note.id, note.contentHash]);
  const run = async () => {
    if (request.current || blocked) return;
    const token = generation.current;
    const current = { controller: new AbortController(), saving: false };
    request.current = current; setPhase('generating'); setMessage(''); setSaved(undefined);
    try {
      const result = await useCases.standardizeNote.execute(note.id, language, { signal: current.controller.signal,
        onCommit: () => { current.saving = true; if (generation.current === token) setPhase('saving'); } });
      if (result) await Promise.all([useNoteStore.getState().refresh(), useKnowledgeLinkStore.getState().refresh()]);
      if (generation.current === token) {
        setSaved(result);
        setMessage(result ? '整理版已保存，原笔记保留。' : '未保存整理版；草稿已取消或原文不足以整理。');
      }
    } catch (error) {
      if (generation.current === token) setMessage(current.controller.signal.aborted ? '已取消整理。' : describeError(error));
    } finally {
      if (request.current === current) request.current = undefined;
      if (generation.current === token) setPhase('idle');
    }
  };
  const tooLong = note.content.length > MAX_STANDARD_NOTE_CHARS;
  return <section style={{ marginBlock: 12 }} aria-label={t('整理为标准笔记')}>
    <h4>{t('整理为标准笔记')}</h4>
    <p>{t('将全文发送给 DeepSeek，按概述、概念、条件、步骤、例子和待澄清问题整理；没有依据的栏目省略。最多 12000 字符，先预览再保存。')}</p>
    {blocked && <p>{t(blocked)}</p>}
    {tooLong && <p>{t('全文超过 12000 字符，请先拆成独立笔记后整理；本功能不会截断全文。')}</p>}
    <button type="button" className="cozy-btn-secondary" disabled={Boolean(blocked) || tooLong || phase !== 'idle'} onClick={() => void run()}>
      {t(phase === 'saving' ? '保存中…' : phase === 'generating' ? '正在整理标准笔记…' : '生成标准笔记草稿')}
    </button>
    {phase === 'generating' && <button type="button" className="cozy-btn-ghost" onClick={() => request.current?.controller.abort()}>{t('取消')}</button>}
    {message && <p role="status">{t(message)}</p>}
    {saved && <button type="button" className="cozy-link" onClick={() => onOpen(saved)}>{t('打开整理版')}</button>}
  </section>;
}
