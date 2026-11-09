import type { KnowledgeProgress } from '@application/ports';
import { useT } from '../../i18n';

const names: Record<KnowledgeProgress['stage'], string> = {
  candidates: '寻找资料', keywords: '关键词检索', rewrite: '扩展问题',
  embedding: '理解问题', vector: '语义检索', rerank: '筛选资料',
  generating: '整理回答', judging: '核对回答',
};

export function KnowledgeActivity({ events, busy, keywordReady, totalMs, firstTokenMs }: {
  events: KnowledgeProgress[];
  busy: boolean;
  keywordReady?: boolean;
  totalMs?: number;
  firstTokenMs?: number;
}) {
  const t = useT();
  const stage = events[events.length - 1]?.stage;
  const durations = new Map<KnowledgeProgress['stage'], number>();
  for (const event of events) if (event.durationMs !== undefined) {
    durations.set(event.stage, (durations.get(event.stage) ?? 0) + event.durationMs);
  }
  const status = stage === 'generating' ? '正在整理回答…' : stage === 'judging' ? '正在核对回答…'
    : keywordReady ? '关键词检索已完成，正在补充语义结果…' : '正在找资料…';
  return <>
    {busy && <p role="status" className="cozy-knowledge-hint">{t(status)}</p>}
    {events.length > 0 && <details className="cozy-knowledge-hint">
      <summary>{t('本次耗时')}{totalMs !== undefined ? ` · ${(totalMs / 1000).toFixed(2)}s` : ''}</summary>
      {firstTokenMs !== undefined && <p>{t('开始输出')} · {(firstTokenMs / 1000).toFixed(2)}s</p>}
      <ul>{[...durations].map(([key, ms]) => <li key={key}>{t(names[key])} · {(ms / 1000).toFixed(2)}s</li>)}</ul>
    </details>}
  </>;
}
