/**
 * 右侧悬浮 Focus HUD —— 紧凑入口版。
 *
 * 不再展示大番茄钟圆环：只保留「进入专注模式」按钮 + 今日使用时长统计。
 * 计时发生在全屏专注层（点按钮进入）；专注进行中给一个轻提示。
 * 使用时长来自 app_usage（桌面 runtime 周期落库），每 30 秒刷新一次。
 */
import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { formatLocalDate } from '@application/shared/utils';
import { useT } from '../../../i18n';
import { useFocusStore } from '../../../stores/focus-store';
import { repositories } from '../../../stores/runtime';

interface FocusHudProps {
  onOpenFocus: () => void;
}

const USAGE_REFRESH_MS = 30_000;

export function FocusHud({ onOpenFocus }: FocusHudProps) {
  const t = useT();
  const active = useFocusStore((state) => state.active);
  const isActive = Boolean(active);
  // 今日应用使用分钟（含专注），每 30 秒刷新
  const [usageMinutes, setUsageMinutes] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void repositories.appUsage
        .get(formatLocalDate(new Date()))
        .then((usage) => {
          if (!cancelled && usage) setUsageMinutes(Math.round(usage.appActiveSeconds / 60));
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, USAGE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
      <p className="focus-hud__summary">{t('今天使用 {0} 分钟', usageMinutes)}</p>
    </aside>
  );
}
