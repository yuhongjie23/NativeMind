import type { ReviewTrace } from '@application/ports';
import { useT } from '../../i18n';

export function ReviewEvidenceDetails({ evidence, insights }: { evidence?: ReviewTrace; insights: string[] }) {
  const t = useT();
  if (!evidence) return insights.length ? <ul className="cozy-review-insights">{insights.map((text, index) => <li key={index}>{text}</li>)}</ul> : null;
  return <div>
    {evidence.observations.map((entry, index) => <div key={index}>
      <p>{entry.text}</p>
      <details>
        <summary>{t('查看依据（生成时记录）')}</summary>
        <ul>{evidence.sources.filter(source => entry.evidenceIds.includes(source.id)).map(source => <li key={source.id}>{source.description}</li>)}</ul>
      </details>
    </div>)}
    {evidence.limitations.length > 0 && <div className="cozy-knowledge-hint">
      <p>{t('记录的局限')}</p>
      <ul>{evidence.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </div>}
  </div>;
}
