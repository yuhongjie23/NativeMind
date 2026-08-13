/**
 * 底部副面板通用容器（V4 §37）。
 *
 * 常驻挂载：六个面板用 hidden 切换显示，关闭后本地状态保留（草稿、备注、
 * 拆解预览等不丢失）。打开时 role="dialog" + aria-modal，焦点进入面板、
 * 关闭回到 Dock；Tab 在面板内循环。关闭前若面板有未完成内容，由根组件
 * 弹确认（requestClose）。
 */
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useT } from '../../../i18n';
import type { PanelKey, SceneId, TimeMode, TimePhase, WeatherType } from '../types';
import type { AmbientMode } from '../types';
import type { DemoSettings } from '../types';
import { DailyPoem } from './DailyPoem';
import { CompanionPanel } from '../panels/CompanionPanel';
import { FocusPanel } from '../panels/FocusPanel';
import { KnowledgePanel } from '../panels/KnowledgePanel';
import { LetterPanel } from '../panels/LetterPanel';
import { ReviewPanel } from '../panels/ReviewPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { TodayPanel } from '../panels/TodayPanel';

const panelMeta: Record<PanelKey, { title: string; subtitle: string }> = {
  today: { title: '今天', subtitle: '把要做的事放轻一点。' },
  focus: { title: '专注', subtitle: '先选一段舒服的时长。' },
  knowledge: { title: '知识/检索', subtitle: '从自己的笔记里找答案。' },
  review: { title: '复盘', subtitle: '看看发生了什么，不急着评价。' },
  companion: { title: '陪伴', subtitle: '它会安静地待在旁边。' },
  letter: { title: '对话', subtitle: '和 Flora 聊聊心里话，历史都留在这里。' },
  settings: { title: '设置', subtitle: '把环境调成适合你的样子。' },
};

export interface SceneControls {
  settings: DemoSettings;
  /** 当前生效的时间阶段（timeMode==='auto' 时由本地时间推导） */
  timePhase: TimePhase;
  setScene: (scene: SceneId) => void;
  setTimeMode: (mode: TimeMode) => void;
  setWeather: (weather: WeatherType) => void;
  setBrightness: (value: number) => void;
  setEnvAnimation: (value: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  setShowPet: (value: boolean) => void;
  setPetAutoRest: (value: boolean) => void;
  setPetQuietInFocus: (value: boolean) => void;
  setAmbientMode: (weather: WeatherType, mode: AmbientMode) => void;
  setAmbientFile: (weather: WeatherType, file?: string) => Promise<void>;
}

interface DemoSheetProps {
  panel: PanelKey | null;
  onClose: () => void;
  sceneControls: SceneControls;
}

const FOCUSABLE = 'button, input, select, [role="switch"], [tabindex]:not([tabindex="-1"])';

export function DemoSheet({ panel, onClose, sceneControls }: DemoSheetProps) {
  const t = useT();
  const sheetRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);

  const active = panel !== null;
  const meta = panel ? panelMeta[panel] : panelMeta.today;

  // 焦点管理与 Tab 循环：只在面板打开时生效
  useEffect(() => {
    if (!panel) return;

    previouslyFocused.current = document.activeElement;
    titleRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = sheetRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === first || activeEl === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (previouslyFocused.current as HTMLElement | null)?.focus?.();
    };
  }, [panel]);

  return (
    <div className="demo-sheet-layer" data-open={active} hidden={!active} role="presentation">
      {active ? (
        <button className="demo-sheet-scrim" type="button" aria-label={t('关闭副面板')} onClick={onClose} />
      ) : null}

      <section
        ref={sheetRef}
        className="demo-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-sheet-title"
      >
        <header className="demo-sheet__header">
          <div className="demo-sheet__heading">
            <div className="demo-sheet__title-row">
              <h2 id="demo-sheet-title" ref={titleRef} tabIndex={-1} className="demo-sheet__title">
                {t(meta.title)}
              </h2>
              {panel === 'today' ? <DailyPoem /> : null}
            </div>
            <p className="demo-sheet__subtitle">{t(meta.subtitle)}</p>
          </div>
          <button type="button" className="demo-sheet__close" aria-label={t('关闭')} onClick={onClose}>
            <X size={18} strokeWidth={2} aria-hidden={true} />
          </button>
        </header>

        <div className="demo-sheet__body">
          {/* 常驻挂载：关闭 / 切换面板时本地状态不丢失 */}
          <div hidden={panel !== 'today'}>
            <TodayPanel />
          </div>
          <div hidden={panel !== 'focus'}>
            <FocusPanel />
          </div>
          <div hidden={panel !== 'knowledge'}>
            <KnowledgePanel />
          </div>
          <div hidden={panel !== 'review'}>
            <ReviewPanel />
          </div>
          <div hidden={panel !== 'companion'}>
            <CompanionPanel />
          </div>
          <div hidden={panel !== 'letter'}>
            <LetterPanel />
          </div>
          <div hidden={panel !== 'settings'}>
            <SettingsPanel controls={sceneControls} />
          </div>
        </div>
      </section>
    </div>
  );
}
