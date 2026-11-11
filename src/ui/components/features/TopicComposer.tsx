import { useEffect, useRef, useState } from 'react';
import type { Note } from '@application/ports';
import { MAX_TOPIC_NOTES } from '@application/use-cases/note/compose-topic';
import { useKnowledgeOrganizationAvailability } from '../../hooks/use-knowledge-organization';
import { useT } from '../../i18n';
import { describeError, useCases } from '../../stores/runtime';
import { useSettingsStore } from '../../stores/settings-store';
import { useNoteStore } from '../../stores/note-store';
import './topic-composer.css';

export function TopicComposer({ notes, onOpen, onConfigure, onImport }: {
  notes: Note[]; onOpen: (note: Note) => void; onConfigure: () => void; onImport: () => void;
}) {
  const t = useT();
  const { blocked, canConfigure } = useKnowledgeOrganizationAvailability();
  const language = useSettingsStore(state => state.language);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [message, setMessage] = useState('');
  const request = useRef<{ controller: AbortController; committing: boolean } | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (!request.current?.committing) request.current?.controller.abort(); };
  }, []);
  const candidates = notes.filter(note => !note.topicPage);
  const chosen = selected.filter(id => candidates.some(note => note.id === id));
  const compose = async () => {
    if (request.current || blocked || chosen.length < 2 || chosen.length > MAX_TOPIC_NOTES) return;
    const current = { controller: new AbortController(), committing: false };
    request.current = current; setPhase('generating'); setMessage('');
    try {
      const page = await useCases.composeTopic.execute(chosen, language, {
        signal: current.controller.signal,
        onCommit: () => { current.committing = true; if (alive.current) setPhase('saving'); },
      });
      if (page) await useNoteStore.getState().refresh();
      if (alive.current && !current.controller.signal.aborted) {
        setMessage(page ? '主题页已保存或复用，原笔记保持不变。' : '未保存主题页：可能未找到合适分组，或你取消了确认。');
        if (page) onOpen(page);
      }
    } catch (error) { if (alive.current && !current.controller.signal.aborted) setMessage(describeError(error)); }
    finally { request.current = undefined; if (alive.current) setPhase('idle'); }
  };
  const visible = candidates.filter(note => note.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <details className="topic-composer">
    <summary><strong>{t('AI 整理笔记目录')}</strong><span>{t('把相关笔记放在一页，复习时少翻找')}</span></summary>
    <div className="topic-composer__body">
      <p>{t('选择 2–8 篇相关笔记，AI 会建议如何分组，生成一页可点击原笔记的目录。')}</p>
      <p className="topic-composer__hint">{t('先看草稿，再决定保存。原笔记不会被合并、改写或删除。')}</p>
      <details className="topic-composer__example">
        <summary>{t('看看生成后的样子')}</summary>
        <div className="topic-composer__preview">
          <small>{t('示例 · 不是已生成的内容')}</small>
          <strong>{t('茶叶学习目录')}</strong>
          <span>{t('成分与含量 → 茶叶成分笔记')}</span>
          <span>{t('冲泡与提取 → 提取率笔记')}</span>
          <small>{t('保存后，点击目录中的笔记名称即可打开原文。')}</small>
        </div>
      </details>
      <div className="topic-composer__privacy">
        <strong>{t('使用 DeepSeek 云端整理')}</strong>
        <p>{t('仅发送你选中笔记的标题与开头片段（每篇最多 1500 字符），可能产生 API 费用。')}</p>
      </div>
      {blocked ? <div className="topic-composer__setup">
        <p>{t(blocked)}</p>
        {canConfigure && <button type="button" className="cozy-btn-primary" onClick={onConfigure}>{t('前往设置 DeepSeek')}</button>}
        <small>{t('这是可选功能，普通笔记和本地检索仍可使用。')}</small>
      </div> : candidates.length < 2 ? <div className="topic-composer__setup">
        <p>{t('先添加至少 2 篇相关笔记，再让 AI 帮你整理目录。')}</p>
        <button type="button" className="cozy-btn-secondary" onClick={onImport}>{t('去导入笔记')}</button>
      </div> : <>
        <h4>{t('选择要一起复习的笔记')}</h4>
        <input className="topic-composer__search" aria-label={t('按标题筛选笔记')} placeholder={t('按标题筛选笔记')}
          value={query} onChange={event => setQuery(event.target.value)} />
        <div className="topic-composer__notes" role="group" aria-label={t('选择要一起复习的笔记')}>
          {visible.map(note => <label key={note.id} className="topic-composer__note" data-selected={chosen.includes(note.id)}>
            <input type="checkbox" checked={chosen.includes(note.id)} disabled={phase !== 'idle' || (!chosen.includes(note.id) && chosen.length >= MAX_TOPIC_NOTES)}
              onChange={event => setSelected(event.target.checked ? [...chosen, note.id] : chosen.filter(id => id !== note.id))} />
            <span>{note.title}</span>
          </label>)}
          {visible.length === 0 && <p>{t('没有匹配的笔记，换个关键词试试。')}</p>}
        </div>
        <div className="topic-composer__selection" aria-live="polite">
          <span>{t('已选 {0} / {1} 篇', chosen.length, MAX_TOPIC_NOTES)}</span>
          {chosen.length > 0 && <button type="button" className="cozy-btn-ghost" disabled={phase !== 'idle'} onClick={() => setSelected([])}>{t('清空选择')}</button>}
        </div>
        {chosen.length > 0 && <div className="topic-composer__selected" aria-label={t('已选笔记')}>
          {chosen.map(id => <button key={id} type="button" className="cozy-chip" disabled={phase !== 'idle'}
            aria-label={t('取消选择：{0}', candidates.find(note => note.id === id)!.title)}
            onClick={() => setSelected(chosen.filter(noteId => noteId !== id))}>{candidates.find(note => note.id === id)!.title} ×</button>)}
        </div>}
        <p className="topic-composer__hint">{t(chosen.length < 2 ? '至少选择 2 篇笔记才能生成草稿。' : chosen.length >= MAX_TOPIC_NOTES ? '已达选择上限，可以取消部分笔记后重新选择。' : '下一步会展示分组理由和原文摘录，由你确认保存。')}</p>
        <button type="button" className="cozy-btn-primary" disabled={chosen.length < 2 || phase !== 'idle'} onClick={() => void compose()}>
          {t(phase === 'saving' ? '保存中…' : phase === 'generating' ? '正在整理目录草稿…' : '生成目录草稿')}
        </button>
      </>}
      {phase === 'generating' && <button type="button" className="cozy-btn-secondary" onClick={() => request.current?.controller.abort()}>{t('取消')}</button>}
      {message && <p role="status">{t(message)}</p>}
    </div>
  </details>;
}
