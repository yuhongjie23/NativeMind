import { useEffect, useRef, useState } from 'react';
import type { Note, TopicMemberDraft, TopicPage } from '@application/ports';
import { useT } from '../../i18n';
import { describeError, repositories } from '../../stores/runtime';

export function TopicPageContents({ topic, onOpen }: { topic: TopicPage; onOpen: (note: Note, start?: number, quote?: string) => void }) {
  const t = useT();
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sources = new Map(topic.sources.map(source => [source.noteId, source]));
  const open = async (member: TopicMemberDraft) => {
    try {
      const source = await repositories.note.findById(member.noteId);
      if (!alive.current) return;
      if (!source) { setMessage('来源笔记已删除，主题页保留的是原有摘录。'); return; }
      const snapshot = sources.get(member.noteId);
      const offset = snapshot?.excerpt.indexOf(member.quote) ?? -1;
      if (source.contentHash !== snapshot?.contentHash || offset < 0 || source.content.slice(offset, offset + member.quote.length) !== member.quote) {
        setMessage('来源笔记已更新，当前摘录是旧版本；请重新生成主题页。'); return;
      }
      onOpen(source, offset, member.quote);
    } catch (error) { if (alive.current) setMessage(describeError(error)); }
  };
  return <section aria-label={t('主题导航')}>
    <p>{t('主题页只组织引用，不合并或删除原笔记。分组是 AI 建议，请核对理由与原文。')}</p>
    {message && <p role="status">{t(message)}</p>}
    {topic.groups.map((group, index) => <section key={index} style={{ marginBlock: 16 }}>
      <h4>{group.title}</h4>
      {group.members.map(member => <div key={member.noteId} style={{ border: '1px solid var(--border)', padding: 10, marginBlock: 8, borderRadius: 8 }}>
        <button type="button" className="cozy-link" onClick={() => void open(member)}>{sources.get(member.noteId)?.title ?? t('笔记')}</button>
        <p>{member.reason}</p><blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{member.quote}</blockquote>
        <button type="button" className="cozy-btn-secondary" onClick={() => void open(member)}>{t('定位原文')}</button>
      </div>)}
    </section>)}
  </section>;
}
