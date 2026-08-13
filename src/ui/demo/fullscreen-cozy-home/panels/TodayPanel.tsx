/**
 * 「今天」面板 —— 真实 Todo。
 *
 * 录入即落库（create），随后 AI 拆解为多条草稿供「采用拆分 / 保留单条」；
 * 任务列表支持完成、删除、启动专注；右栏今日摘要来自真实数据。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLocalDate, isSameLocalDay } from '@application/shared/utils';
import { Check, Play, Plus, Trash2, X } from 'lucide-react';
import type { TodoDraft } from '@application/ports';
import { useT } from '../../../i18n';
import { useFocusStore, selectTodayFocusMinutes } from '../../../stores/focus-store';
import { useFocusOverlayStore } from '../../../stores/focus-overlay';
import { useCheckInStore } from '../../../stores/checkin-store';
import { CheckInCalendar } from '../components/CheckInCalendar';
import { useConfirmationStore } from '../../../stores/confirmation-store';
import { useToastStore } from '../../../stores/toast-store';
import { useTodoStore } from '../../../stores/todo-store';
import { describeError, repositories } from '../../../stores/runtime';
import { usePanelDirty } from '../panel-dirty';
import { formatClock } from '../utils';
import type { Todo } from '@shared-types/domain';

interface Group {
  key: string;
  label: string;
  items: Todo[];
}

const groupTodos = (todos: Todo[]): Group[] => {
  const byGoal = new Map<string, Todo[]>();
  const plain: Todo[] = [];
  for (const todo of todos) {
    if (todo.sourceGoalId) {
      const list = byGoal.get(todo.sourceGoalId) ?? [];
      list.push(todo);
      byGoal.set(todo.sourceGoalId, list);
    } else {
      plain.push(todo);
    }
  }
  const groups: Group[] = [...byGoal.entries()].map(([key, items]) => ({
    key,
    label: items[0].title.split(/[·:：]/)[0].trim() || '同组任务',
    items,
  }));
  groups.push({ key: 'plain', label: '今天', items: plain });
  return groups.filter((group) => group.items.length > 0);
};

export function TodayPanel() {
  const t = useT();
  const todos = useTodoStore((state) => state.todos);
  const refresh = useTodoStore((state) => state.refresh);
  const create = useTodoStore((state) => state.create);
  const structureGoal = useTodoStore((state) => state.structureGoal);
  const replaceWithDrafts = useTodoStore((state) => state.replaceWithDrafts);
  const deleteTodo = useTodoStore((state) => state.deleteTodo);
  const complete = useTodoStore((state) => state.complete);
  const startFocus = useFocusStore((state) => state.start);
  const todayMinutes = useFocusStore(selectTodayFocusMinutes);
  const focusHistory = useFocusStore((state) => state.history);
  const checkInToday = useCheckInStore((state) => state.today);
  const checkInMonth = useCheckInStore((state) => state.month);
  const checkInYearMonth = useCheckInStore((state) => state.yearMonth);
  const checkInLoading = useCheckInStore((state) => state.loading);
  const refreshCheckIn = useCheckInStore((state) => state.refresh);
  const refreshCheckInMonth = useCheckInStore((state) => state.refreshMonth);

  const [title, setTitle] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [preview, setPreview] = useState<{ savedId: string; drafts: TodoDraft[] } | null>(null);
  const [localError, setLocalError] = useState('');
  // 当日应用使用时长（分钟），打卡卡片展示
  const [usageMinutes, setUsageMinutes] = useState(0);
  // 取消标记：用户点 X 后让在途的 AI 拆解结果作废，避免十几秒后预览又弹回来
  const splitTokenRef = useRef(0);
  // 同步去重标记：React 的 setState 不会同步生效，双击/快速回车必须用 ref 拦截，
  // 否则同一 tick 里第二次调用仍看到 splitting=false，会创建第二条任务
  const splittingRef = useRef(false);

  useEffect(() => {
    void refresh();
    void refreshCheckIn();
  }, [refresh, refreshCheckIn]);

  // 当日使用时长：app_usage 由桌面 runtime 周期落库，这里只读展示。
  // 失败静默（web 演示/首次运行无记录 → 显示 0）
  useEffect(() => {
    let cancelled = false;
    void repositories.appUsage
      .get(formatLocalDate(new Date()))
      .then((usage) => {
        if (!cancelled && usage) setUsageMinutes(Math.round(usage.appActiveSeconds / 60));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 有未提交草稿/拆解预览时标记未完成，关闭面板需确认
  useEffect(() => {
    usePanelDirty.getState().setDirty('today', title.trim().length > 0 || splitting || Boolean(preview));
  }, [title, splitting, preview]);

  const todayStr = formatLocalDate(new Date());
  const visibleTodos = useMemo(
    () =>
      todos.filter(
        (todo) =>
          todo.status !== 'completed' ||
          todo.scheduledDate === todayStr ||
          isSameLocalDay(todo.createdAt),
      ),
    [todos, todayStr],
  );

  const pending = visibleTodos.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled');
  const completedToday = visibleTodos.filter((todo) => todo.status === 'completed').length;
  const todayFocusSessions = focusHistory.filter(
    (session) => session.status === 'completed' && isSameLocalDay(session.startedAt),
  );
  const groups = useMemo(() => groupTodos(visibleTodos), [visibleTodos]);

  // 今日打卡：与 RecordDailyCheckInUseCase 同口径（当日排期或当日新建的任务）
  const todayTasks = useMemo(
    () => todos.filter((todo) => todo.scheduledDate === todayStr || isSameLocalDay(todo.createdAt)),
    [todos, todayStr],
  );
  const todayTotal = todayTasks.length;
  const todayCompleted = todayTasks.filter((todo) => todo.status === 'completed').length;
  const todayCheckInDone = todayTotal > 0 && todayCompleted >= todayTotal;
  const studyGoal = checkInToday?.studyGoalMinutes ?? 50;
  const studyPercent = Math.min(100, Math.round((todayMinutes / studyGoal) * 100));

  const shiftCheckInMonth = (delta: number) => {
    const [y, m] = checkInYearMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    void refreshCheckInMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const submitTitle = async () => {
    const value = title.trim();
    // 用 ref 同步拦截：双击/快速回车在同一 tick 里也只会创建一条
    if (!value || splittingRef.current) return;
    splittingRef.current = true;
    const token = splitTokenRef.current;
    setTitle('');
    setPreview(null);
    setLocalError('');
    setSplitting(true);

    try {
      const saved = await create({ title: value });
      if (!saved) return;
      useToastStore.getState().show(t('已加入'));

      const result = await structureGoal(value);
      if (token !== splitTokenRef.current) return; // 用户已取消，丢弃结果
      if (result.length > 0) setPreview({ savedId: saved.id, drafts: result });
    } catch (structureError) {
      if (token === splitTokenRef.current) {
        setLocalError(`${describeError(structureError)} 已直接加入，之后可在任务上再拆解。`);
      }
    } finally {
      splittingRef.current = false;
      setSplitting(false);
    }
  };

  /** 取消添加：让在途拆解结果作废，防止预览自己弹回来 */
  const cancelAdd = () => {
    splitTokenRef.current += 1;
    splittingRef.current = false;
    setTitle('');
    setPreview(null);
    setLocalError('');
    setSplitting(false);
  };

  /** 删除任务：永久操作，先确认 */
  const handleDelete = async (todo: Todo) => {
    const ok = await useConfirmationStore.getState().requestSimple({
      title: t('删除任务'),
      message: t('确定删除「{0}」吗？此操作不可撤销。', todo.title),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (ok) await deleteTodo(todo.id);
  };

  /** 替换为拆分：事务化「删原任务 + 整批写拆分」，任一失败都不丢原任务 */
  const adoptDrafts = async () => {
    if (!preview) return;
    await replaceWithDrafts(preview.savedId, preview.drafts);
    // store 的 run() 会把失败吞进 error 而不抛；失败时不能伪装成成功
    const storeError = useTodoStore.getState().error;
    if (storeError) {
      useToastStore.getState().show(`拆分失败，原任务已保留：${storeError}`, 'error');
      return; // 保留 preview 供重试
    }
    useToastStore.getState().show(`已拆成 ${preview.drafts.length} 条`, 'ok');
    setPreview(null);
  };

  return (
    <div className="cozy-today">
      <div className="cozy-today__col">
        <div className="cozy-add-task">
          <Plus size={18} strokeWidth={2} aria-hidden={true} className="cozy-add-task__icon" />
          <label className="sr-only" htmlFor="today-new-task">今天想推进什么</label>
          <input
            id="today-new-task"
            className="cozy-add-task__input"
            type="text"
            placeholder="今天想推进什么？"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setLocalError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitTitle();
            }}
          />
          {title.trim() || preview || localError || splitting ? (
            <button
              type="button"
              className="cozy-add-task__cancel"
              aria-label="取消添加"
              title="不添加了"
              onClick={cancelAdd}
            >
              <X size={16} strokeWidth={2} aria-hidden={true} />
            </button>
          ) : null}
          <button
            type="button"
            className="cozy-add-task__submit"
            aria-label="添加任务"
            disabled={!title.trim() || splitting}
            onClick={() => void submitTitle()}
          >
            <Plus size={18} strokeWidth={2} aria-hidden={true} />
          </button>
        </div>

        {splitting ? (
          <p className="cozy-today-hint" role="status">
            {t('已保存，正在尝试拆解…')}
          </p>
        ) : null}

        {preview && preview.drafts.length > 0 ? (
          <div className="cozy-split-preview">
            <p className="cozy-today-hint">
              {t('AI 能把这条拆成 {0} 个任务，要替换吗？', preview.drafts.length)}
            </p>
            <ul className="cozy-task-list">
              {preview.drafts.map((draft, index) => (
                <li key={index} className="cozy-task-row">
                  <span className="cozy-task-row__text">{draft.title}</span>
                  {draft.estimatedMinutes ? (
                    <span className="cozy-task-row__time">{draft.estimatedMinutes} min</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="cozy-today-hint-actions">
              <button type="button" className="cozy-btn-primary" onClick={() => void adoptDrafts()}>
                {t('替换为拆分（{0} 条）', preview.drafts.length)}
              </button>
              <button type="button" className="cozy-btn-secondary" onClick={() => setPreview(null)}>
                {t('保留单条')}
              </button>
            </div>
          </div>
        ) : null}

        {localError ? <p className="cozy-today-error">{localError}</p> : null}

        {groups.length === 0 ? (
          <p className="cozy-today-empty">{t('还没有任务。上面加一条开始吧。')}</p>
        ) : (
          <div className="cozy-task-group">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="cozy-task-group__head">
                  <span>{group.label}</span>
                  <span className="cozy-task-group__count">
                    {group.items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled').length} /{' '}
                    {group.items.length}
                  </span>
                </div>
                <ul className="cozy-task-list">
                  {group.items.map((todo) => {
                    const done = todo.status === 'completed';
                    return (
                      <li key={todo.id} className="cozy-task-row" data-done={done}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={done}
                          aria-label={todo.title}
                          className="cozy-task-row__check"
                          onClick={() => {
                            if (done) return;
                            void complete(todo.id);
                          }}
                        >
                          {done ? <Check size={13} strokeWidth={3} aria-hidden={true} /> : null}
                        </button>
                        <span className="cozy-task-row__text">{todo.title}</span>
                        {todo.estimatedMinutes ? (
                          <span className="cozy-task-row__time">{todo.estimatedMinutes} min</span>
                        ) : null}
                        <button
                          type="button"
                          className="cozy-task-row__focus"
                          aria-label={`专注：${todo.title}`}
                          title="为此任务开始一段专注"
                          onClick={() => {
                            void startFocus({ todoId: todo.id });
                            // 点开始直接进全屏专注，不再停留
                            useFocusOverlayStore.getState().openOverlay();
                          }}
                        >
                          <Play size={13} strokeWidth={2} aria-hidden={true} />
                        </button>
                        <button
                          type="button"
                          className="cozy-task-row__delete"
                          aria-label={`删除：${todo.title}`}
                          title="删除任务"
                          onClick={() => void handleDelete(todo)}
                        >
                          <Trash2 size={13} strokeWidth={1.75} aria-hidden={true} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cozy-today__divider" aria-hidden="true" />

      <div className="cozy-today__col">
        <div className="checkin-card">
          <h3 className="panel-section-title">{t('今日打卡')}</h3>
          {todayCheckInDone ? (
            <p className="checkin-card__status checkin-card__status--done">{t('今日已学习 ✅')}</p>
          ) : (
            <p className="checkin-card__status">
              {t('完成全部任务即打卡成功（{0}/{1}）', todayCompleted, todayTotal)}
            </p>
          )}
          <div className="checkin-card__bar-row">
            <span className="checkin-card__label">{t('任务')}</span>
            <div
              className="checkin-card__bar"
              role="progressbar"
              aria-valuenow={todayTotal > 0 ? Math.round((todayCompleted / todayTotal) * 100) : 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="checkin-card__bar-fill"
                style={{ width: `${todayTotal > 0 ? (todayCompleted / todayTotal) * 100 : 0}%` }}
              />
            </div>
            <span className="checkin-card__value">
              {todayCompleted}/{todayTotal}
            </span>
          </div>
          <div className="checkin-card__bar-row">
            <span className="checkin-card__label">{t('使用时长')}</span>
            <span className="checkin-card__value">
              {t('{0} 分钟', usageMinutes)}
            </span>
          </div>
          <div className="checkin-card__bar-row">
            <span className="checkin-card__label">{t('学习')}</span>
            <div
              className="checkin-card__bar"
              role="progressbar"
              aria-valuenow={studyPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="checkin-card__bar-fill" style={{ width: `${studyPercent}%` }} />
            </div>
            <span className="checkin-card__value">
              {todayMinutes}/{studyGoal} 分钟
            </span>
          </div>
        </div>

        <h3 className="panel-section-title">{t('打卡日历')}</h3>
        <CheckInCalendar
          yearMonth={checkInYearMonth}
          records={checkInMonth}
          loading={checkInLoading}
          onShift={shiftCheckInMonth}
        />

        <h3 className="panel-section-title">{t('今天')}</h3>
        <ul className="cozy-today-summary">
          <li>{t('{0} 项待完成', pending.length)}</li>
          <li>{t('已完成 {0} 项', completedToday)}</li>
          <li>{t('专注 {0} 分钟', todayMinutes)}</li>
        </ul>

        <h3 className="panel-section-title">{t('今日节律')}</h3>
        {todayFocusSessions.length === 0 ? (
          <p className="cozy-today-empty">{t('还没有完成的专注段。')}</p>
        ) : (
          <ol className="cozy-rhythm">
            {todayFocusSessions.slice(-5).map((session) => (
              <li key={session.id} className="cozy-rhythm__item" data-type="focus">
                <span className="cozy-rhythm__dot" aria-hidden="true" />
                <time className="cozy-rhythm__time">{formatClock(new Date(session.startedAt))}</time>
                <span className="cozy-rhythm__label">专注 {session.durationMinutes} 分钟</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
