import type { StandardNoteProposal } from '@application/use-cases/note/standardize-note';
import { useT } from '../../i18n';
import { Modal } from '../common/Modal';

export function StandardNoteConfirmation({ proposal, onApprove, onReject }: {
  proposal: StandardNoteProposal; onApprove: () => void; onReject: () => void;
}) {
  const t = useT();
  const [source, ...sections] = proposal.content.split(/^## /m);
  return <Modal open dismissible={false} title={t('检查标准笔记草稿')} footer={<>
    <button type="button" className="cozy-btn-secondary" onClick={onReject}>{t('取消')}</button>
    <button type="button" className="cozy-btn-primary" onClick={onApprove}>{t('保存为新的整理版笔记')}</button>
  </>}>
    <p>{t('请核对条件、数字、公式与遗漏。原文摘录存在，不代表 AI 整理完全准确。')}</p>
    <h3 style={{ overflowWrap: 'anywhere' }}>{proposal.title}</h3>
    <p style={{ overflowWrap: 'anywhere' }}>{source}</p>
    {sections.map((section, index) => {
      const split = section.indexOf('\n');
      return <section key={index}><h4>{section.slice(0, split)}</h4>
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{section.slice(split + 1).trim()}</div></section>;
    })}
    <details><summary>{t('对照完整原笔记')}</summary>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto' }}>{proposal.original}</div>
    </details>
    <p>{t('保存为独立笔记，原笔记保持不变。之后可以继续拆分卡片和查找关联。')}</p>
  </Modal>;
}
