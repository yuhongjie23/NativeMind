/**
 * 全屏极简专注模式（demo）。
 *
 * 点击主界面「专注」直接进入：整屏只保留 背景 + 番茄钟倒计时 + 音频开关。
 * 后续上传 UI 资源（背景图等）后，替换 `.focus-overlay__bg` 的占位样式即可。
 *
 * 专注背景音乐单独配置（设置 → 专注 → 专注背景音乐），与天气环境音互不影响；
 * 播放状态住在 focus-music store，会话开始自动播、结束自动停。
 * 未配置时点音频按钮弹出选歌菜单：可从「已配置的天气背景」或「音乐库」里挑一首，
 * 或从本地文件选择；配置后按钮显示极简图标 + 歌名 + 播放态。
 */
import { Check, FolderOpen, Music, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFocusMode } from '../../hooks/use-focus-mode';
import { useT } from '../../i18n';
import { useConfirmationStore } from '../../stores/confirmation-store';
import { useFocusStore } from '../../stores/focus-store';
import { useFocusMusicStore } from '../../stores/focus-music';
import { useMusicStore } from '../../stores/music-store';
import { describeError } from '../../stores/runtime';
import { useSettingsStore } from '../../stores/settings-store';
import { useToastStore } from '../../stores/toast-store';

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const canPick = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DURATION_OPTIONS = [15, 25, 45, 60];

interface FullscreenFocusProps {
  onClose: () => void;
  /** 与主页共享的音量 / 静音状态 */
  volume: number;
  muted: boolean;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
}

export function FullscreenFocus({ onClose, volume, muted, onVolumeChange, onToggleMute }: FullscreenFocusProps) {
  const t = useT();
  const active = useFocusStore((state) => state.active);
  const start = useFocusStore((state) => state.start);
  const complete = useFocusStore((state) => state.complete);
  const abort = useFocusStore((state) => state.abort);
  const pause = useFocusStore((state) => state.pause);
  const resume = useFocusStore((state) => state.resume);
  const pausedAt = useFocusStore((state) => state.pausedAt);
  const error = useFocusStore((state) => state.error);
  const focusView = useFocusMode();
  const defaultMinutes = useSettingsStore((state) => state.focus.defaultDurationMinutes);

  const musicFile = useFocusMusicStore((state) => state.file);
  const musicPlaying = useFocusMusicStore((state) => state.playing);
  const setMusicFile = useFocusMusicStore((state) => state.setFile);
  const toggleMusic = useFocusMusicStore((state) => state.toggle);
  const playMusic = useFocusMusicStore((state) => state.play);

  const updateFocusMusic = useSettingsStore((state) => state.updateFocusMusic);
  const ambientFilesByWeather = useSettingsStore((state) => state.ambientFilesByWeather);
  const libraryTracks = useMusicStore((state) => state.tracks);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // 区分单击（开关音量条）与双击（静音），避免双击时音量条一闪而过
  const volumeClickTimerRef = useRef<number | null>(null);
  const handleVolumeClick = () => {
    if (volumeClickTimerRef.current) {
      window.clearTimeout(volumeClickTimerRef.current);
      volumeClickTimerRef.current = null;
      return;
    }
    volumeClickTimerRef.current = window.setTimeout(() => {
      volumeClickTimerRef.current = null;
      setVolumeOpen((value) => !value);
    }, 250);
  };
  const handleVolumeDoubleClick = () => {
    if (volumeClickTimerRef.current) {
      window.clearTimeout(volumeClickTimerRef.current);
      volumeClickTimerRef.current = null;
    }
    onToggleMute();
  };
  // 时长选择：想 45 分钟不用退出全屏去设置里改默认值
  const [duration, setDuration] = useState(defaultMinutes);

  const isActive = Boolean(active);
  const paused = Boolean(pausedAt);
  const elapsed = isActive && focusView.remaining === 0;
  const timeText = isActive ? focusView.display : `${String(duration).padStart(2, '0')}:00`;

  // ESC / 关闭：专注中先弹确认（需点击）才退出；空闲直接退出
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const exitFocus = async () => {
    if (activeRef.current) {
      const ok = await useConfirmationStore.getState().requestSimple({
        title: t('退出专注'),
        message: t('正在专注中，确定要退出吗？这段不会自动完成。'),
        confirmLabel: t('退出'),
        danger: true,
      });
      if (ok) onClose();
    } else {
      onClose();
    }
  };
  const exitFocusRef = useRef(exitFocus);
  exitFocusRef.current = exitFocus;
  const onStartRef = useRef<() => Promise<void>>(async () => {});
  // 选完专注音乐后的自动播放重试监听：跨组件生命周期存引用，卸载时必须移除，
  // 否则关闭全屏后下一次点击会把它当「手势」在主界面无会话地偷播专注音乐
  const autoplayRetryRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void exitFocusRef.current();
      // 空格：空闲开始专注；专注中暂停/恢复
      if (event.code === 'Space') {
        event.preventDefault();
        const state = useFocusStore.getState();
        if (!state.active) void onStartRef.current();
        else if (state.pausedAt) state.resume();
        else state.pause();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (autoplayRetryRef.current) {
        window.removeEventListener('pointerdown', autoplayRetryRef.current);
        autoplayRetryRef.current = null;
      }
    };
  }, []);

  /** 应用一首歌为专注音乐：落库 + 存 store + 播放 */
  const applyAsFocusMusic = async (path: string) => {
    await updateFocusMusic(path);
    setMusicFile(path);
    setPickerOpen(false);
    void playMusic();
    // 读字节是异步的，自动播放的「用户激活」会丢 → 下一次点击（真实手势）重试一次；
    // 引用存进 ref，全屏关闭（卸载）时由上面的 effect 清理，避免在主界面偷播
    const retry = () => {
      if (!useFocusMusicStore.getState().playing) {
        void useFocusMusicStore.getState().play();
      }
    };
    autoplayRetryRef.current = retry;
    window.addEventListener('pointerdown', retry, { once: true });
  };

  /** 从本地文件选择 → 复制进数据目录 → 应用 */
  const pickFromLocal = async () => {
    if (!canPick) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        title: '选择专注背景音乐',
        filters: [{ name: '音频', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a'] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      const { invoke } = await import('@tauri-apps/api/core');
      const readable = await invoke<string>('file_import_into_data_dir', { path });
      await applyAsFocusMusic(readable);
    } catch (error) {
      useToastStore.getState().show(`选择文件失败：${describeError(error)}`, 'error');
    }
  };

  /** 音乐库曲目 → 复制进数据目录 → 应用 */
  const pickFromLibrary = async (trackPath: string) => {
    if (!canPick) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const readable = await invoke<string>('file_import_into_data_dir', { path: trackPath });
      await applyAsFocusMusic(readable);
    } catch {
      useToastStore.getState().show('无法读取该曲目，请换一首', 'error');
    }
  };

  // 已配置的天气自定义背景歌（去重）
  const weatherOptions = [...new Set(Object.values(ambientFilesByWeather).filter(Boolean))];

  const onStart = async () => {
    await start({ durationMinutes: duration });
  };
  onStartRef.current = onStart;

  const onComplete = async () => {
    await complete(undefined);
    // 完成后直接退出全屏专注，回到原界面
    onClose();
  };

  const onAbort = async () => {
    const ok = await useConfirmationStore.getState().requestSimple({
      title: t('放弃这段专注'),
      message: t('放弃后这段不会计入专注统计。确定吗？'),
      confirmLabel: t('放弃'),
      danger: true,
    });
    if (!ok) return;
    await abort('用户手动中断');
  };

  return (
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label="专注模式">
      {/* 背景占位：后续上传 UI 资源后替换为真实背景图 */}
      <div className="focus-overlay__bg" aria-hidden="true" />

      <button
        type="button"
        className="focus-overlay__close"
        aria-label={t('退出专注')}
        onClick={() => void exitFocus()}
      >
        <X size={20} strokeWidth={2} aria-hidden="true" />
      </button>

      <div className="focus-overlay__center">
        <div className="focus-overlay__ring">
          <strong>{timeText}</strong>
          <span>{t('番茄钟')}</span>
        </div>

        <p className="focus-overlay__task">
          {active
            ? active.todoId
              ? t('专注中')
              : t('未关联任务 · 专注中')
            : t('准备开始一段专注')}
        </p>
        {elapsed ? (
          <p className="focus-overlay__hint" role="status">
            {t('时间到了。收个尾再点完成也没关系。')}
          </p>
        ) : null}
        {paused ? (
          <p className="focus-overlay__hint" role="status">
            {t('已暂停，按空格继续。')}
          </p>
        ) : null}
        {error ? <p className="focus-overlay__error">{error}</p> : null}

        <div className="focus-overlay__actions">
          {!isActive ? (
            <>
              <div className="focus-overlay__durations" role="group" aria-label={t('选择专注时长')}>
                {DURATION_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className="focus-overlay__duration"
                    data-active={duration === minutes}
                    aria-pressed={duration === minutes}
                    onClick={() => setDuration(minutes)}
                  >
                    {minutes}
                  </button>
                ))}
              </div>
              <button type="button" className="focus-overlay__primary" onClick={() => void onStart()}>
                <Play size={18} strokeWidth={2} aria-hidden="true" />
                {t('开始专注 {0} 分钟', duration)}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="focus-overlay__primary" onClick={() => void onComplete()}>
                <Check size={18} strokeWidth={2} aria-hidden="true" />
                {t('完成这段')}
              </button>
              <button type="button" className="focus-overlay__ghost" onClick={() => (paused ? void resume() : void pause())}>
                {paused ? (
                  <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
                )}
                {paused ? t('继续') : t('暂停')}
              </button>
              <button type="button" className="focus-overlay__ghost" onClick={() => void onAbort()}>
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('放弃')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 右下角：音量 + 专注背景音乐开关 */}
      <div className="focus-overlay__audio-wrap">
        <button
          type="button"
          className="focus-overlay__audio"
          aria-label={muted ? t('已静音（双击取消静音）') : t('音量（双击全部静音）')}
          title={t('单击调节音量，双击全部静音')}
          aria-expanded={volumeOpen}
          onClick={handleVolumeClick}
          onDoubleClick={handleVolumeDoubleClick}
        >
          {muted ? (
            <VolumeX size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
          )}
          <span>{muted ? t('已静音') : t('音量')}</span>
        </button>
        {volumeOpen ? (
          <div className="focus-overlay__volume">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
              aria-label={t('音量大小')}
            />
            <button type="button" className="focus-overlay__volume-mute" onClick={onToggleMute}>
              {muted ? t('取消静音') : t('全部静音')}
            </button>
          </div>
        ) : null}

        {pickerOpen ? (
          <div className="focus-overlay__picker" role="menu" aria-label="选择专注背景音乐">
            <p className="focus-overlay__picker-title">选择专注背景音乐</p>
            {weatherOptions.length > 0 ? (
              <div className="focus-overlay__picker-group">
                <span className="focus-overlay__picker-label">已配置的天气背景</span>
                {weatherOptions.map((path) => (
                  <button
                    key={path}
                    type="button"
                    role="menuitem"
                    onClick={() => void applyAsFocusMusic(path)}
                  >
                    <Music size={13} strokeWidth={2} aria-hidden="true" />
                    <span>{fileName(path)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {libraryTracks.length > 0 ? (
              <div className="focus-overlay__picker-group">
                <span className="focus-overlay__picker-label">音乐库</span>
                {libraryTracks.map((track) => (
                  <button
                    key={track.path}
                    type="button"
                    role="menuitem"
                    onClick={() => void pickFromLibrary(track.path)}
                  >
                    <Music size={13} strokeWidth={2} aria-hidden="true" />
                    <span>{track.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" role="menuitem" disabled={!canPick} onClick={() => void pickFromLocal()}>
              <FolderOpen size={13} strokeWidth={2} aria-hidden="true" />
              <span>从本地文件选择…</span>
            </button>
            <button type="button" role="menuitem" onClick={() => setPickerOpen(false)}>
              取消
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="focus-overlay__audio"
          data-on={musicPlaying}
          aria-label={musicFile ? (musicPlaying ? '关闭专注音乐' : '播放专注音乐') : '选择专注背景音乐'}
          onClick={() => (musicFile ? void toggleMusic() : setPickerOpen((value) => !value))}
        >
          {musicPlaying ? (
            <Pause size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Music size={16} strokeWidth={2} aria-hidden="true" />
          )}
          <span>{musicFile ? fileName(musicFile) : '选择专注音乐'}</span>
        </button>
      </div>
    </div>
  );
}
