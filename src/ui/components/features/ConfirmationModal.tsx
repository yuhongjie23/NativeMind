/**
 * 写入确认弹窗
 *
 * 所有 AI 建议型写入的最后一道闸。dismissible={false}：必须显式点同意或拒绝，
 * 点空白处溜走会让 Promise 一直挂着，用例也就卡在那儿了。
 *
 * 确认内容按动作类型渲染：
 * - generate_review：直接把复盘正文 / 洞察 / 下一步渲染成可读文本，
 *   不把原始 JSON 丢给用户看。
 * - 其它：仍以 JSON 兜底展示原始 payload（写库前的原始数据，方便排查）。
 */
import { useConfirmation } from '../../hooks/use-confirmation';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

const actionLabel: Record<string, string> = {
  create_todos: '创建任务',
  create_knowledge_link: '建立知识关联',
  generate_review: '生成复盘',
  import_search_result: '导入搜索结果',
};

/** 复盘草稿：把结构化字段渲染成可读文本，避免把原始 JSON 暴露给用户 */
const renderReviewPayload = (payload: unknown) => {
  const draft = payload as {
    summary?: string;
    content?: string;
    insights?: string[];
    nextTodos?: string[];
  };
  return (
    <div className="confirm-detail__review">
      {draft.summary ? (
        <p className="confirm-detail__review-summary">{draft.summary}</p>
      ) : null}
      {draft.content ? (
        <p className="confirm-detail__review-content">{draft.content}</p>
      ) : null}
      {draft.insights && draft.insights.length > 0 ? (
        <ul className="confirm-detail__review-list">
          {draft.insights.map((insight, index) => (
            <li key={index}>{insight}</li>
          ))}
        </ul>
      ) : null}
      {draft.nextTodos && draft.nextTodos.length > 0 ? (
        <p className="confirm-detail__review-next">
          下一步：{draft.nextTodos.join('；')}
        </p>
      ) : null}
    </div>
  );
};

export function ConfirmationModal() {
  const { proposal, queued, approve, reject } = useConfirmation();

  if (!proposal) return null;

  return (
    <Modal
      dismissible={false}
      footer={
        <>
          <Button onClick={reject} variant="ghost">
            不用了
          </Button>
          <Button onClick={approve} variant="primary">
            写入
          </Button>
        </>
      }
      open
      title={actionLabel[proposal.actionType] ?? '确认写入'}
    >
      <p className="confirm-summary">{proposal.summary}</p>

      <details className="confirm-detail">
        <summary>看看具体内容</summary>
        {proposal.actionType === 'generate_review' ? (
          renderReviewPayload(proposal.payload)
        ) : (
          <pre>{JSON.stringify(proposal.payload, null, 2)}</pre>
        )}
      </details>

      <p className="confirm-meta">
        来源：{proposal.source === 'ai' ? 'AI 建议' : '规则生成'}
        {queued > 0 ? ` · 还有 ${queued} 项待确认` : ''}
      </p>
    </Modal>
  );
}
