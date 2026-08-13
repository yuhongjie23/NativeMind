/**
 * 顶部 HUD（V5 §13.1）。
 *
 * 不是整条不透明导航条：左侧品牌 + 场景名（轻量、局部半透明底），
 * 右侧把场景/天气（紧凑 segmented）、日期、时间、音量按信息优先级排列，
 * 时间数字最清晰但不使用大号展示字体。专注 active 时整层降低存在感。
 */
import { useEffect, useRef, useState } from 'react';
import { CloudRain, Flower2, Moon, Music2, Snowflake, Sparkles, Sun, Sunset, Volume2, VolumeX } from 'lucide-react';
import { useT } from '../../../i18n';
import appLogo from '../../../components/ui/logo.png';
import type { SceneId, TimeMode, TimePhase, WeatherType } from '../types';

interface TopHudProps {
  sceneName: string;
  sceneId: SceneId;
  weather: WeatherType;
  timePhase: TimePhase;
  timeMode: TimeMode;
  timeText: string;
  dateText: string;
  /** 主音量 0-1 */
  volume: number;
  /** 是否全部静音 */
  muted: boolean;
  /** 背景音乐是否在播（场景背景音乐或天气自定义歌）；独立于主音量 */
  bgmOn?: boolean;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  /** 切换背景音乐开/关（不碰音乐库，不与主音量键冲突） */
  onToggleBgm?: () => void;
  onSceneChange: (scene: SceneId) => void;
  onWeatherChange: (weather: WeatherType) => void;
  /** 固定切换白天/夜晚 */
  onToggleDayNight: () => void;
}

const weatherOptions: { value: WeatherType; label: string; Icon: typeof Sun }[] = [
  { value: 'clear', label: '晴天', Icon: Sun },
  { value: 'rain', label: '下雨', Icon: CloudRain },
  { value: 'snow', label: '下雪', Icon: Snowflake },
  { value: 'spring', label: '春日', Icon: Flower2 },
  { value: 'summer', label: '夏日', Icon: Sparkles },
];

export function TopHud({
  sceneName,
  sceneId,
  weather,
  timePhase,
  timeMode,
  timeText,
  dateText,
  volume,
  muted,
  bgmOn = false,
  onVolumeChange,
  onToggleMute,
  onToggleBgm,
  onSceneChange,
  onWeatherChange,
  onToggleDayNight,
}: TopHudProps) {
  const t = useT();
  const [volumeOpen, setVolumeOpen] = useState(false);
  const clickTimer = useRef<number | undefined>(undefined);

  // 单击：延迟后切换音量面板；双击：取消单击、关闭面板并全部静音
  const handleVolumeClick = () => {
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      setVolumeOpen((value) => !value);
    }, 220);
  };

  const handleVolumeDoubleClick = () => {
    window.clearTimeout(clickTimer.current);
    setVolumeOpen(false);
    onToggleMute();
  };

  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  return (
    <header className="top-hud" data-phase={timePhase}>
      <div className="top-hud__brand">
        <img className="top-hud__logo" src={appLogo} alt="" aria-hidden="true" />
        <strong>NativeMind</strong>
        <span className="top-hud__scene">{sceneName}</span>
      </div>

      <div className="top-hud__right">
        <div className="hud-group" role="group" aria-label={t('场景与天气选择')}>
          <div className="hud-seg" role="group" aria-label={t('场景选择')}>
            <button
              type="button"
              className="hud-pill"
              data-active={sceneId === 'study-room'}
              aria-pressed={sceneId === 'study-room'}
              onClick={() => onSceneChange('study-room')}
            >
              {t('房间')}
            </button>
            <button
              type="button"
              className="hud-pill"
              data-active={sceneId === 'library'}
              aria-pressed={sceneId === 'library'}
              onClick={() => onSceneChange('library')}
            >
              {t('图书馆')}
            </button>
          </div>

          {/* 图书馆只有白天/夜晚，天气不参与（去除雪/雨等干扰项） */}
          {sceneId !== 'library' ? (
            <>
              <span className="hud-sep" aria-hidden="true" />
              <div className="hud-seg" role="group" aria-label={t('天气选择')}>
                {weatherOptions.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    className="hud-icon-pill"
                    data-active={weather === value}
                    aria-pressed={weather === value}
                    aria-label={t(label)}
                    title={t(label)}
                    onClick={() => onWeatherChange(value)}
                  >
                    <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* 固定白天/黄昏/夜晚切换：点击循环；图标显示当前时段 */}
        <button
          type="button"
          className="hud-icon-pill"
          aria-label={t('切换时段')}
          title={t('切换时段')}
          data-active={timeMode === 'day' || timeMode === 'dusk' || timeMode === 'night'}
          onClick={onToggleDayNight}
        >
          {timePhase === 'day' ? (
            <Sun size={17} strokeWidth={1.75} aria-hidden="true" />
          ) : timePhase === 'dusk' ? (
            <Sunset size={17} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Moon size={17} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>

        <span className="top-hud__date">{dateText}</span>
        <span className="top-hud__time" aria-live="off">
          {timeText}
        </span>

        {/* 背景音乐开关：只控制场景背景音乐 + 天气自定义歌，独立于主音量键 */}
        <button
          type="button"
          className="hud-icon-pill"
          data-active={bgmOn}
          aria-pressed={bgmOn}
          aria-label={bgmOn ? t('关闭背景音乐') : t('开启背景音乐')}
          title={bgmOn ? t('关闭背景音乐') : t('开启背景音乐')}
          onClick={onToggleBgm}
        >
          <Music2 size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>

        <div className="top-hud__volume">
          <button
            type="button"
            className="hud-icon-pill"
            aria-label={muted ? t('已静音（双击取消静音）') : t('音量（双击全部静音）')}
            title={t('单击调节音量，双击全部静音')}
            aria-expanded={volumeOpen}
            onClick={handleVolumeClick}
            onDoubleClick={handleVolumeDoubleClick}
          >
            {muted ? (
              <VolumeX size={17} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Volume2 size={17} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          {volumeOpen ? (
            <div className="top-hud__volume-pop">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
                aria-label={t('音量大小')}
              />
              <button type="button" className="top-hud__volume-mute" onClick={onToggleMute}>
                {muted ? t('取消静音') : t('全部静音')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
