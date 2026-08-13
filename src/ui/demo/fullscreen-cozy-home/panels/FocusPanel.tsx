/**
 * 「专注」面板 —— 入口化。
 *
 * 主页不再展示大计时器（番茄钟 UI 骨架保留，后续由 AI 生成的时钟替换），
 * 只保留一个「进入专注模式」按钮 + 今日/本周统计；计时发生在全屏专注层。
 */
import { Play } from 'lucide-react';
import { useEffect } from 'react';
import { useT } from '../../../i18n';
import {
  selectTodayFocusMinutes,
  selectWeekFocusMinutes,
  useFocusStore,
} from '../../../stores/focus-store';
import { useFocusOverlayStore } from '../../../stores/focus-overlay';

export function FocusPanel() {
  const t = useT();
  const todayMinutes = useFocusStore(selectTodayFocusMinutes);
  const weekMinutes = useFocusStore(selectWeekFocusMinutes);
  const refresh = useFocusStore((state) => state.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="cozy-focus-panel cozy-focus-panel--entry">
      {/* 番茄钟骨架：留给后续 AI 生成的时钟 */}
      <div className="cozy-focus-ring--skeleton" aria-hidden="true" />

      <button
        type="button"
        className="cozy-btn-primary cozy-focus-entry"
        onClick={() => useFocusOverlayStore.getState().openOverlay()}
      >
        <Play size={16} strokeWidth={2} aria-hidden="true" />
        {t('进入专注模式')}
      </button>
      <p className="cozy-focus-copy">{t('开始一段专注，番茄钟会在这里等你。')}</p>

      <div className="cozy-focus-stats" aria-label="专注统计">
        <span>
          {t('今日')} <strong>{todayMinutes}</strong> {t('分钟')}
        </span>
        <span>
          {t('本周')} <strong>{weekMinutes}</strong> {t('分钟')}
        </span>
      </div>
    </div>
  );
}
