import { useState } from 'react';
import type { TopicDraft, TopicProposal } from '@application/ports';
import { Modal } from '../common/Modal';
import { useT } from '../../i18n';

export function TopicConfirmation({ proposal, onApprove, onReject }: {
  proposal: TopicProposal; onApprove: (draft: TopicDraft) => void; onReject: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(proposal.title);
  const [groups, setGroups] = useState(() => proposal.groups.map(group => ({ ...group, selected: true })));
  const kept = groups.filter(group => group.selected);
  const sources = new Map(proposal.sources.map(source => [source.noteId, source]));
  return <Modal open dismissible={false} title={t('预览笔记目录')} footer={<>
    <button type="button" className="cozy-btn-secondary" onClick={onReject}>{t('取消')}</button>
    <button type="button" className="cozy-btn-primary" disabled={!title.trim() || !kept.length || kept.some(group => !group.title.trim())}
      onClick={() => onApprove({ title, groups: kept.map(({ title: groupTitle, members }) => ({ title: groupTitle, members })) })}>{t('保存为目录笔记')}</button>
  </>}>
    <p>{t('主题页只组织引用，不合并或删除原笔记。分组是 AI 建议，请核对理由与原文。')}</p>
    <p>{t('每篇最多分析开头 1500 字符。没有足够依据的笔记可能不参与分组。')}</p>
    <p>{t('相同来源版本的已有主题页会复用，不覆盖你的编辑。')}</p>
    <label>{t('目录名称')}<input className="topic-composer__search" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
    {groups.map((group, index) => <section key={index} style={{ border: '1px solid var(--border)', padding: 12, marginBlock: 12, borderRadius: 8 }}>
      <label><input type="checkbox" checked={group.selected}
        onChange={event => setGroups(items => items.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item))} />{t('保留分组')}</label>
      <input aria-label={t('分组标题')} className="topic-composer__search" maxLength={120} value={group.title} disabled={!group.selected}
        onChange={event => setGroups(items => items.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} />
      {group.members.map(member => <div key={member.noteId}>
        <strong>{sources.get(member.noteId)?.title}</strong><p>{member.reason}</p>
        <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{member.quote}</blockquote>
      </div>)}
    </section>)}
  </Modal>;
}
