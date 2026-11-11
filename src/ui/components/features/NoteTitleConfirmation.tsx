import type { NoteTitleProposal } from '@application/use-cases/note/organize-note-title';
import { useT } from '../../i18n';
import { Modal } from '../common/Modal';

export function NoteTitleConfirmation({ proposal, onApprove, onReject }: {
  proposal: NoteTitleProposal; onApprove: () => void; onReject: () => void;
}) {
  const t = useT();
  return <Modal open dismissible={false} title={t('检查 AI 建议的笔记标题')} footer={<>
    <button type="button" className="cozy-btn-secondary" onClick={onReject}>{t('取消')}</button>
    <button type="button" className="cozy-btn-primary" onClick={onApprove}>{t('保存改名与链接')}</button>
  </>}>
    <p style={{ overflowWrap: 'anywhere' }}>{t('原标题')}：{proposal.oldTitle}</p>
    <p><strong>{t('建议标题')}：{proposal.newTitle}</strong></p>
    <p>{proposal.reason}</p>
    <p>{t('原文依据')}</p><blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{proposal.quote}</blockquote>
    <p>{t('将改名为“{0}”，更新 {1} 处正文链接。', proposal.newTitle, proposal.linkCount)}</p>
    {proposal.ambiguous && <p>{t('原标题有重名，无法判断其他笔记链接的目标。本次仅改名，不修改这些链接。')}</p>}
    <p>{t('仅分析正文前 6000 字符。请核对标题能否代表内容；原始文件和来源地址保留。')}</p>
  </Modal>;
}
