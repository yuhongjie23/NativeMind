import { useState } from 'react';
import type { NoteCardDraft, NoteCardsProposal } from '@application/ports';
import { Modal } from '../common/Modal';
import { useT } from '../../i18n';

export function NoteCardsConfirmation({ proposal, onApprove, onReject }: {
  proposal: NoteCardsProposal;
  onApprove: (cards: NoteCardDraft[]) => void;
  onReject: () => void;
}) {
  const t = useT();
  const [cards, setCards] = useState(() => proposal.cards.map(card => ({ ...card, selected: true })));
  const selected = cards.filter(card => card.selected);
  const valid = selected.every(card => card.title.trim() && card.body.trim());
  return <Modal open dismissible={false} title={t('检查知识卡片后保存')} footer={<>
    <button type="button" className="cozy-btn-secondary" onClick={onReject}>{t('取消')}</button>
    <button type="button" className="cozy-btn-primary" disabled={!valid}
      onClick={() => onApprove(selected.map(({ title, body, quote }) => ({ title, body, quote })))}>
      {selected.length ? t('确认保存 {0} 张卡片', selected.length) : t('本段不建卡，确认继续')}
    </button>
  </>}>
    <p>{t('原笔记会保留。可修改标题与正文；原文摘录用于核对，不能修改。')}</p>
    <p>{t('来源：{0}', proposal.sourceTitle)}</p>
    <p role="status">{t('本段覆盖第 {0}–{1} 字符，共 {2} 字符。', proposal.batch.start + 1, proposal.batch.end, proposal.totalChars)}</p>
    {proposal.batch.inputStart < proposal.batch.start && <p>{t('已附带上一段的少量上下文，帮助理解段落边界。')}</p>}
    {!cards.length && <p>{t('本段未生成知识卡片。你可以确认跳过本段，或取消后重试。')}</p>}
    <p>{t('AI 整理不等于事实核验，请对照原文检查。相同出处的已有卡片会复用，不覆盖你的修改。')}</p>
    {cards.map((card, index) => <section key={index} style={{ border: '1px solid var(--border)', padding: 12, marginBlock: 12, borderRadius: 8, minWidth: 0 }}>
      <label><input type="checkbox" checked={card.selected}
        onChange={event => setCards(items => items.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item))} /> {t('保留卡片 {0}', index + 1)}</label>
      <label style={{ display: 'block' }}>{t('标题')}
        <input style={{ width: '100%', boxSizing: 'border-box' }} maxLength={120} value={card.title} disabled={!card.selected}
          onChange={event => setCards(items => items.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} />
      </label>
      <label style={{ display: 'block' }}>{t('AI 整理与解释（非原文）')}
        <textarea style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} rows={5} maxLength={2000} value={card.body} disabled={!card.selected}
          onChange={event => setCards(items => items.map((item, i) => i === index ? { ...item, body: event.target.value } : item))} />
      </label>
      <strong>{t('资料原文摘录')}</strong>
      <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{card.quote}</blockquote>
    </section>)}
  </Modal>;
}
