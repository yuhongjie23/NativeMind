/**
 * 右侧悬浮 Focus HUD —— 紧凑入口版。
 *
 * 不再展示大番茄钟圆环：只保留「进入专注模式」按钮 + 今日专注分钟统计。
 * 计时发生在全屏专注层（点按钮进入）；专注进行中给一个轻提示。
 */
import { Timer } from 'lucide-react';
import { useT } from '../../../i18n';
import { selectTodayFocusMinutes, useFocusStore } from '../../../stores/focus-store';

interface FocusHudProps {
  onOpenFocus: () => void;
}

export function FocusHud({ onOpenFocus }: FocusHudProps) {
  const t = useT();
  const active = useFocusStore((state) => state.active);
  const todayMinutes = useFocusStore(selectTodayFocusMinutes);
  const isActive = Boolean(active);

  return (
    <aside
      className="focus-hud focus-hud--compact"
      data-idle={!isActive}
      aria-label={t('专注入口')}
    >
      <button type="button" className="focus-hud__enter" onClick={onOpenFocus}>
        <Timer size={15} strokeWidth={2} aria-hidden="true" />
        {t('进入专注模式')}
      </button>
      {isActive ? (
        <p className="focus-hud__live" role="status">
          {t('专注进行中…')}
        </p>
      ) : null}
      <p className="focus-hud__summary">{t('今天 {0} 分钟', todayMinutes)}</p>
    </aside>
  );
}
