/**
 * 「复盘」面板 —— 真实复盘生成与阅览。
 *
 * 日/周/月 一个整体 segmented 控件：既决定生成哪类复盘，也过滤展示 ——
 * 最近复盘与历史列表都只显示当前选中的周期类型。历史条目可展开看完整内容，
 * 也支持逐条删除（删除是破坏性写入，走全局确认弹窗，确认后才删）。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n';
import type { ReviewLog } from '@shared-types/domain';
import { useReviewStore } from '../../../stores/review-store';
import { useTodoStore } from '../../../stores/todo-store';
import { eventBus } from '../../../stores/runtime';

const periods = [
  { value: 'daily', label: '日' },
  { value: 'weekly', label: '周' },
  { value: 'monthly', label: '月' },
] as const;

type PeriodValue = (typeof periods)[number]['value'];

const typeLabel = (type: ReviewLog['reviewType']): string =>
  type === 'daily' ? '日' : type === 'weekly' ? '周' : '月';

const generateByPeriod: Record<PeriodValue, () => Promise<void>> = {
  daily: () => useReviewStore.getState().generateDaily(),
  weekly: () => useReviewStore.getState().generateWeekly(),
  monthly: () => useReviewStore.getState().generateMonthly(),
};

export function ReviewPanel() {
  const t = useT();
  const reviews = useReviewStore((state) => state.reviews);
  const generating = useReviewStore((state) => state.generating);
  const lastOutcome = useReviewStore((state) => state.lastOutcome);
  const error = useReviewStore((state) => state.error);
  const refresh = useReviewStore((state) => state.refresh);
  const deleteReview = useReviewStore((state) => state.deleteReview);
  const createDrafts = useTodoStore((state) => state.createDrafts);

  const [period, setPeriod] = useState<PeriodValue>('daily');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 把复盘「下一步」建议创建为任务：走 createDrafts（executeDrafts 确认门）
  const createNextAsTodos = async (nextTodos: string[]) => {
    if (nextTodos.length === 0) return;
    await createDrafts(
      nextTodos.map((title) => ({ title, description: '来自复盘建议' })),
    );
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 复盘生成确认后发布 ReviewGenerated，这里监听事件刷新列表
  useEffect(() => {
    const off = eventBus.subscribe('ReviewGenerated', () => void refresh());
    return off;
  }, [refresh]);

  // 只显示当前选中周期类型的复盘
  const filtered = useMemo(
    () => reviews.filter((review) => review.reviewType === period),
    [reviews, period],
  );

  const latest = filtered[0];

  return (
    <div className="cozy-review">
      <div className="cozy-segmented cozy-segmented--period" role="group" aria-label={t('复盘周期')}>
        {periods.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="cozy-segmented__item"
            data-active={period === value}
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div className="cozy-review__cols">
        <section>
          <h3 className="panel-section-title">
            {t('最近{0}复盘', t(periods.find((p) => p.value === period)?.label ?? ''))}
          </h3>
          {generating ? <p className="cozy-knowledge-hint">{t('正在生成…')}</p> : null}
          {lastOutcome ? <p className="cozy-review__feedback">{lastOutcome}</p> : null}
          {error ? <p className="cozy-today-error">{error}</p> : null}
          {latest ? (
            <article className="cozy-review-card">
              <p className="cozy-note-card__source">
                {latest.date} · {t(typeLabel(latest.reviewType))}
              </p>
              <p className="cozy-review-card__content">{latest.content}</p>
              {latest.statistics && Object.keys(latest.statistics).length > 0 ? (
                <p className="cozy-review-card__stats">
                  {[
                    latest.statistics.appMinutes !== undefined
                      ? t('使用 {0} 分钟', latest.statistics.appMinutes)
                      : null,
                    latest.statistics.focusMinutes
                      ? t('专注 {0} 分钟', latest.statistics.focusMinutes)
                      : null,
                    latest.statistics.tasksTotal
                      ? t('任务 {0}/{1} 完成', latest.statistics.tasksCompleted ?? 0, latest.statistics.tasksTotal)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              {latest.insights.length > 0 ? (
                <ul className="cozy-review-insights">
                  {latest.insights.map((insight) => (
                    <li key={insight}>{insight}</li>
                  ))}
                </ul>
              ) : null}
              {latest.nextTodos.length > 0 ? (
                <div className="cozy-review-next">
                  <p>{t('下一步：{0}', latest.nextTodos.join('；'))}</p>
                  <button
                    type="button"
                    className="cozy-btn-secondary cozy-review-next__create"
                    onClick={() => void createNextAsTodos(latest.nextTodos)}
                  >
                    {t('创建为任务')}
                  </button>
                </div>
              ) : null}
            </article>
          ) : (
            <p className="cozy-today-empty">
              {t('还没有{0}复盘。选这个周期生成一份。', t(periods.find((p) => p.value === period)?.label ?? ''))}
            </p>
          )}
        </section>

        <section>
          <h3 className="panel-section-title">
            {t('历史（{0}）', t(typeLabel(period)))}
          </h3>
          {filtered.length === 0 ? (
            <p className="cozy-today-empty">{t('暂无{0}复盘记录。', t(typeLabel(period)))}</p>
          ) : (
            <>
              <p className="cozy-review-history__hint">
                {t('点击条目展开查看完整内容，可逐条删除。')}
              </p>
              <ul className="cozy-review-history">
                {filtered.slice(0, 30).map((review) => {
                  const expanded = expandedId === review.id;
                  return (
                    <li key={review.id} className="cozy-review-history__item" data-expanded={expanded}>
                      <div className="cozy-review-history__line">
                        <button
                          type="button"
                          className="cozy-review-history__row"
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : review.id)}
                        >
                          <span className="cozy-review-history__date">{review.date}</span>
                          <span className="cozy-review-history__type">{t(typeLabel(review.reviewType))}</span>
                          <span className="cozy-review-history__summary">
                            {review.summary ?? review.content.slice(0, 40)}
                          </span>
                          <span className="cozy-review-history__chevron" aria-hidden="true">
                            {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="cozy-review-history__delete"
                          aria-label={`删除 ${review.date} 的复盘`}
                          title="删除这条复盘"
                          onClick={() => void deleteReview(review.id)}
                        >
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden={true} />
                        </button>
                      </div>
                      {expanded ? (
                        <div className="cozy-review-history__detail">
                          <p className="cozy-review-card__content">{review.content}</p>
                          {review.insights.length > 0 ? (
                            <ul className="cozy-review-insights">
                              {review.insights.map((insight) => (
                                <li key={insight}>{insight}</li>
                              ))}
                            </ul>
                          ) : null}
                          {review.nextTodos.length > 0 ? (
                            <p className="cozy-review-next">下一步：{review.nextTodos.join('；')}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="cozy-review__footer">
        <button
          type="button"
          className="cozy-btn-primary"
          disabled={generating}
          onClick={() => void generateByPeriod[period]()}
        >
          {t('生成{0}复盘', t(periods.find((p) => p.value === period)?.label ?? ''))}
        </button>
      </div>
    </div>
  );
}