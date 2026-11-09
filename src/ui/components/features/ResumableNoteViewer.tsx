import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotePageRange, ReadingPosition, ReadingProgress } from '@application/ports';
import { useCases } from '../../stores/runtime';
import { useT } from '../../i18n';
import { NoteViewer } from './NoteViewer';

interface Props { active?: boolean; noteId: string; content: string; pageRanges?: NotePageRange[]; initialCharStart?: number; initialAnchor?: string }
export function ResumableNoteViewer({ noteId, active: visible = true, ...props }: Props) {
  const t = useT();
  const [previous, setPrevious] = useState<ReadingProgress>();
  const [question, setQuestion] = useState('');
  const [recalling, setRecalling] = useState(false);
  const [recall, setRecall] = useState('');
  const [resume, setResume] = useState<ReadingPosition>();
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const pending = useRef<ReadingPosition | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const position = pending.current;
    pending.current = undefined;
    if (position) void useCases.knowledgeReading.save(noteId, { position }).catch(() => setMessage('阅读位置保存失败，请重试。'));
  }, [noteId]);
  useEffect(() => {
    if (!visible) return;
    setReady(false); setResume(undefined); setRecalling(false);
    let active = true;
    void useCases.knowledgeReading.load(noteId).then(value => {
      if (active) { setPrevious(value); setQuestion(value?.question ?? ''); setReady(true); }
    }).catch(() => { if (active) setMessage('阅读记录加载失败，请重新打开资料。'); });
    return () => { active = false; flush(); };
  }, [noteId, flush, visible]);
  const remember = useCallback((position: ReadingPosition) => {
    pending.current = position;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }, [flush]);
  const continueReading = () => { setRecalling(false); setResume(previous?.position); };
  return <div>
    {previous ? <section aria-label={t('接着上次')} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <strong>{t('接着上次')}</strong>
      <p>{previous.position?.page
        ? t(previous.position.exact ? '上次读到第 {0} 页' : '上次大约读到第 {0} 页', previous.position.page)
        : t(previous.position ? '已保留上次阅读位置与问题。' : '上次留下了一个问题。')}</p>
      {previous.question ? <p>{t('留下的问题：{0}', previous.question)}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="cozy-btn-secondary" onClick={continueReading}>{t('继续阅读')}</button>
        <button type="button" className="cozy-btn-ghost" onClick={() => { flush(); setRecalling(true); }}>{t('先回忆一下')}</button>
      </div>
    </section> : null}
    {recalling ? <div>
      <p>{t('先不看原文：你还记得哪些要点？写几句，再打开原文核对。')}</p>
      <textarea aria-label={t('我的回忆')} value={recall} onChange={event => setRecall(event.target.value)} maxLength={2000} style={{ width: '100%', boxSizing: 'border-box' }} />
      <p className="hint">{t('这段回忆仅供本次核对，不会自动保存或交给 AI。')}</p>
      <button type="button" className="cozy-btn-secondary" onClick={continueReading}>{t('打开原文核对')}</button>
    </div> : <>
      {recall ? <details><summary>{t('我的回忆')}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{recall}</p></details> : null}
      <NoteViewer {...props} initialCharStart={resume?.offset ?? props.initialCharStart} initialAnchor={resume?.anchor ?? props.initialAnchor} onReadingPosition={ready ? remember : undefined} />
    </>}
    <label style={{ display: 'block', marginTop: 10 }}>{t('留给下次的问题')}
      <input value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} disabled={!ready} style={{ width: '100%', boxSizing: 'border-box' }} />
    </label>
    <button type="button" className="cozy-btn-ghost" disabled={!ready} onClick={() => {
      flush();
      void useCases.knowledgeReading.save(noteId, { question }).then(() => setMessage('问题已保存到本地。')).catch(() => setMessage('问题保存失败，请重试。'));
    }}>{t('保存问题')}</button>
    {message ? <p role="status">{t(message)}</p> : null}
  </div>;
}
