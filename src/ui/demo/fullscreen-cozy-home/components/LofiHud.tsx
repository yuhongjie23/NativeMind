/**
 * 右下角 lo-fi 音乐条 —— 真实播放器。
 *
 * 播放状态与 Audio 元素住在 useMusicStore（模块级单例，切面板不断）。
 * 上一首 / 播放暂停 / 下一首 + 曲目列表弹层 + 顺序/随机。未配置音乐目录
 * 或目录里没有音频时给出明确提示并禁用控制。
 */
import { ListMusic, Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t, useT } from '../../../i18n';
import { useMusicStore } from '../../../stores/music-store';
import { useSettingsStore } from '../../../stores/settings-store';
import type { SceneId, WeatherType } from '../types';

interface LofiHudProps {
  sceneId: SceneId;
  weather: WeatherType;
  /** 是否正在播放自定义背景音频（天气自定义歌） */
  customPlaying?: boolean;
  /** 正在播放的自定义背景音频文件名 */
  customTrackName?: string;
  /** 是否有背景音乐（内置环境音或自定义）在播放 */
  bgmPlaying?: boolean;
  /** 统一切换背景音乐/音乐库 */
  onToggleBgm?: () => void;
}

const ambientLabel = (sceneId: SceneId, weather: WeatherType): string => {
  if (sceneId === 'library') return t('图书馆 · 安静');
  const weatherText = weather === 'rain' ? t('雨声') : weather === 'snow' ? t('雪声') : t('安静');
  return `${t('书房')} · ${weatherText}`;
};

export function LofiHud({
  sceneId,
  weather,
  customPlaying = false,
  customTrackName,
  bgmPlaying = false,
  onToggleBgm,
}: LofiHudProps) {
  const t = useT();
  const tracks = useMusicStore((state) => state.tracks);
  const current = useMusicStore((state) => state.current);
  const playing = useMusicStore((state) => state.playing);
  const mode = useMusicStore((state) => state.mode);
  const refresh = useMusicStore((state) => state.refresh);
  const play = useMusicStore((state) => state.play);
  const next = useMusicStore((state) => state.next);
  const prev = useMusicStore((state) => state.prev);
  const toggleMode = useMusicStore((state) => state.toggleMode);
  const musicDir = useSettingsStore((state) => state.paths.musicDir);

  const [listOpen, setListOpen] = useState(false);

  // 音乐目录变化（含设置加载完成）时重新拉取清单
  useEffect(() => {
    void refresh();
  }, [musicDir, refresh]);

  const hasMusic = tracks.length > 0;
  // 自定义背景音频播放时优先显示它，而不是音乐库的默认曲名
  const trackName =
    customPlaying && customTrackName ? customTrackName : (current?.name ?? 'Quiet Window');
  const emptyHint = musicDir ? t('目录下没有音频文件') : t('未配置音乐目录');
  const statusText = customPlaying
    ? t('自定义背景音乐 · 循环')
    : hasMusic
      ? ambientLabel(sceneId, weather)
      : emptyHint;
  const isPlaying = playing || customPlaying || bgmPlaying;

  return (
    <aside className="lofi-hud" aria-label={t('lo-fi 音乐')}>
      <button
        type="button"
        className="lofi-hud__btn"
        aria-label={t('上一首')}
        disabled={!current}
        onClick={() => prev()}
      >
        <SkipBack size={14} strokeWidth={2} aria-hidden={true} />
      </button>

      <button
        type="button"
        className="lofi-hud__btn lofi-hud__btn--primary"
        aria-label={isPlaying ? t('暂停') : t('播放')}
        onClick={() => onToggleBgm?.()}
      >
        {isPlaying ? (
          <Pause size={15} strokeWidth={2} aria-hidden={true} />
        ) : (
          <Play size={15} strokeWidth={2} aria-hidden={true} />
        )}
      </button>

      <button
        type="button"
        className="lofi-hud__btn"
        aria-label={t('下一首')}
        disabled={!current}
        onClick={() => next()}
      >
        <SkipForward size={14} strokeWidth={2} aria-hidden={true} />
      </button>

      <div className="lofi-hud__meta">
        <strong>{trackName}</strong>
        <small>{statusText}</small>
      </div>

      <div className="lofi-hud__eq" aria-hidden="true" data-playing={isPlaying}>
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <button
        type="button"
        className="lofi-hud__btn"
        aria-label={t('曲目列表')}
        aria-expanded={listOpen}
        onClick={() => setListOpen((value) => !value)}
      >
        <ListMusic size={15} strokeWidth={2} aria-hidden={true} />
      </button>

      {listOpen ? (
        <div className="lofi-hud__list">
          {tracks.length === 0 ? (
            <p className="lofi-hud__list-empty">
              {musicDir
                ? t('该目录下没有音频文件（mp3 / flac / wav / ogg / m4a）')
                : '未配置音乐目录，到 设置 → 路径 添加后即可播放'}
            </p>
          ) : (
            <>
              <p className="lofi-hud__count">曲目 · 共 {tracks.length} 首</p>
              <ul className="lofi-hud__tracks">
                {tracks.map((track) => (
                  <li key={track.path}>
                    <button
                      type="button"
                      data-active={current?.path === track.path}
                      onClick={() => void play(track)}
                    >
                      <span>{track.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="lofi-hud__mode"
                onClick={() => toggleMode()}
              >
                <Repeat size={13} strokeWidth={2} aria-hidden={true} />
                {mode === 'sequence' ? t('顺序播放') : t('随机播放')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
