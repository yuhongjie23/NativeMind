import type { ReviewFollowUp, ReviewLog } from '@application/ports';
import { useT } from '../../../i18n';

const labels: Record<ReviewFollowUp['status'], string> = {
  pending: '未开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消', deleted: '任务已删除',
};

export function ReviewNextSteps({ review, followUps, adopting, onAdopt }: {
  review: ReviewLog; followUps: ReviewFollowUp[]; adopting: boolean;
  onAdopt: (reviewId: string, suggestion: string) => Promise<void>;
}) {
  const t = useT();
  const current = followUps.filter(entry => entry.reviewId === review.id);
  const previous = current.filter(entry => !review.nextTodos.some(text => text.trim() === entry.suggestion));
  return <div className="cozy-review-next">
    {review.nextTodos.length > 0 && <p>{t('下一步建议（采用后才创建任务）')}</p>}
    {Array.from(new Set(review.nextTodos.map(text => text.trim()))).map(text => {
      const followUp = current.find(entry => entry.suggestion === text);
      const suggestion = review.evidence?.suggestions.find(entry => entry.text.trim() === text);
      return <div key={text}>
        <p>{text}</p>
        {suggestion && <details>
          <summary>{t('建议依据')}</summary>
          <ul>{review.evidence?.sources.filter(source => suggestion.evidenceIds.includes(source.id)).map(source => <li key={source.id}>{source.description}</li>)}</ul>
        </details>}
        {followUp ? <p role="status">{t('已采用')} · {t(labels[followUp.status])}</p> :
          <button type="button" className="cozy-btn-secondary" disabled={adopting} onClick={() => void onAdopt(review.id, text)}>{t('创建为任务')}</button>}
      </div>;
    })}
    {previous.length > 0 && <details><summary>{t('此前采用的建议')}</summary>
      <ul>{previous.map(entry => <li key={entry.id}>{entry.suggestion} · {t(labels[entry.status])}</li>)}</ul>
    </details>}
  </div>;
}
