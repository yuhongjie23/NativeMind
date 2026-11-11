import { useEffect, useRef, useState } from 'react';
import type { Note, NoteOrganizationProgress } from '@application/ports';
import { useKnowledgeOrganization } from '../../hooks/use-knowledge-organization';
import { useT } from '../../i18n';
import { describeError, eventBus, repositories, useCases } from '../../stores/runtime';
import { useNoteStore } from '../../stores/note-store';
import { useSettingsStore } from '../../stores/settings-store';
import { StandardizeNote } from './StandardizeNote';

export function NoteOrganizationTools({ note, onOpen }: { note: Note; onOpen: (note: Note, start?: number, quote?: string) => void }) {
  const t = useT();
  const blocked = useKnowledgeOrganization();
  const language = useSettingsStore(state => state.language);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [message, setMessage] = useState('');
  const [cards, setCards] = useState<Note[]>([]);
  const [progress, setProgress] = useState<NoteOrganizationProgress>();
  const [loading, setLoading] = useState(true);
  const request = useRef<{ controller: AbortController; committing: boolean } | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let current = true;
    let sequence = 0;
    setLoading(true);
    const load = async () => {
      const seq = ++sequence;
      try {
        const [value, savedProgress] = await Promise.all([useCases.organizeNote.listCards(note.id), useCases.organizeNote.progress(note.id)]);
        if (current && sequence === seq) { setCards(value); setProgress(savedProgress); }
      } catch { if (current && sequence === seq) setMessage('知识卡片列表加载失败，请重新打开笔记。'); }
      finally { if (current && sequence === seq) setLoading(false); }
    };
    void load();
    const off = eventBus.subscribe('NoteOrganizationProgressChanged', event => { if (event.noteId === note.id) void load(); });
    return () => {
      current = false;
      off();
      alive.current = false;
      if (!request.current?.committing) request.current?.controller.abort();
    };
  }, [note.id, note.contentHash]);

  const organize = async () => {
    if (request.current || blocked || loading || !progress?.nextBatch) return;
    const current = { controller: new AbortController(), committing: false };
    request.current = current;
    setPhase('generating'); setMessage('');
    try {
      const saved = await useCases.organizeNote.execute(note.id, language, {
        signal: current.controller.signal,
        onCommit: () => { current.committing = true; if (alive.current) setPhase('saving'); },
      });
      if (saved.length) await useNoteStore.getState().refresh();
      if (alive.current && !current.controller.signal.aborted) {
        const [nextCards, nextProgress] = await Promise.all([useCases.organizeNote.listCards(note.id), useCases.organizeNote.progress(note.id)]);
        if (!alive.current || current.controller.signal.aborted) return;
        setCards(nextCards); setProgress(nextProgress);
        setMessage(saved.length ? t('已保存或复用 {0} 张知识卡片，原笔记保持不变。', saved.length)
          : (nextProgress?.reviewedChars ?? 0) > progress.reviewedChars ? t('本段已确认，未新增卡片。') : t('未保存新卡片。'));
      }
    } catch (error) {
      if (alive.current && !current.controller.signal.aborted) setMessage(describeError(error));
    } finally {
      request.current = undefined;
      if (alive.current) setPhase('idle');
    }
  };

  const restart = async () => {
    if (phase !== 'idle') return;
    setLoading(true); setMessage('');
    try {
      await useCases.organizeNote.restart(note.id);
      const next = await useCases.organizeNote.progress(note.id);
      if (alive.current) setProgress(next);
    } catch (error) { if (alive.current) setMessage(describeError(error)); }
    finally { if (alive.current) setLoading(false); }
  };

  const openSource = async () => {
    const origin = note.cardSource;
    if (!origin) return;
    try {
      const source = await repositories.note.findById(origin.noteId);
      if (!alive.current) return;
      if (!source) { setMessage('原笔记已删除，仍保留生成时的原文摘录。'); return; }
      if (source.contentHash !== origin.contentHash || source.content.slice(origin.charStart, origin.charEnd) !== origin.quote) {
        setMessage('原笔记已修改，以下保留的是生成时的原文摘录。');
        return;
      }
      onOpen(source, origin.charStart, origin.quote);
    } catch (error) { if (alive.current) setMessage(describeError(error)); }
  };

  return <section style={{ marginBlock: 12, minWidth: 0 }} aria-label={t('知识卡片')}>
    <StandardizeNote key={note.id} note={note} onOpen={onOpen} />
    {note.cardSource && <div>
      <p><strong>{t('资料原文摘录')}</strong> · {note.cardSource.title}</p>
      <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.cardSource.quote}</blockquote>
      <button type="button" className="cozy-btn-secondary" onClick={() => void openSource()}>{t('定位原文')}</button>
    </div>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="cozy-btn-secondary" disabled={Boolean(blocked) || phase !== 'idle' || loading || !progress?.nextBatch} onClick={() => void organize()}>
        {t(phase === 'saving' ? '保存中…' : phase === 'generating' ? '正在整理知识卡片…'
          : progress && !progress.nextBatch ? '本版本全文已处理' : progress?.reviewedChars ? '继续整理下一段' : 'DeepSeek 整理为知识卡片')}
      </button>
      {phase === 'generating' && <button type="button" className="cozy-btn-secondary" onClick={() => request.current?.controller.abort()}>{t('取消')}</button>}
      {Boolean(progress?.reviewedChars) && <button type="button" className="cozy-btn-secondary" disabled={phase !== 'idle' || loading}
        onClick={() => void restart()}>{t('重新检查全文（保留卡片）')}</button>}
    </div>
    {blocked && <p className="cozy-knowledge-hint">{t(blocked)}</p>}
    {progress && <div aria-live="polite">
      <p>{t('已确认处理 {0} / {1} 字符，共 {2} 段。', progress.reviewedChars, progress.totalChars, progress.reviewedBatches)}</p>
      {progress.sourceChanged && <p>{t('原笔记已更新，将从新版本开头整理；已有卡片保留。')}</p>}
      {progress.nextBatch ? <p>{t('下一段：第 {0}–{1} 字符。每次点击仅处理一段。', progress.nextBatch.start + 1, progress.nextBatch.end)}</p>
        : <p>{t('全文范围已处理，不代表知识点已全部提取或内容已核实。')}</p>}
    </div>}
    {message && <p role="status">{t(message)}</p>}
    {cards.length > 0 && <div><h4>{t('从这篇笔记提取的卡片')}</h4><ul>{cards.map(card =>
      <li key={card.id}><button type="button" className="cozy-link" onClick={() => onOpen(card)}>{card.title}</button></li>)}</ul></div>}
  </section>;
}
