/**
 * 「设置」面板 —— 真实设置 + 视觉场景偏好。
 *
 * 真实设置走 useSettingsStore（专注时长/环境音/提示音、陪伴开关/名称、
 * 隐私、双模型、主题、AI 模式），改完即存。场景/天气/时间预览/亮度等
 * 视觉偏好仍是本地 Demo 状态（会话内有效）。
 */
import { useEffect, useState } from 'react';
import { t as globalT, useT } from '../../../i18n';
import { checkModelAvailable, getAppPaths, listInstalledModels, type AppPathsInfo } from '@infrastructure/paths/paths-api';
import type { AppLanguage, ThemeMode } from '@shared-types/config';
import { ENGINE_LIST } from '@shared-types/search-config';
import type { SearchEngineConfig } from '@shared-types/search-config';
import type { SceneControls } from '../components/DemoSheet';
import { useSettingsStore } from '../../../stores/settings-store';
import { aiMode } from '../../../stores/runtime';
import type { AmbientMode, TimeMode, WeatherType } from '../types';

const weatherRows: { weather: WeatherType; label: string }[] = [
  { weather: 'clear', label: '晴' },
  { weather: 'rain', label: '雨' },
  { weather: 'snow', label: '雪' },
  { weather: 'spring', label: '春' },
  { weather: 'summer', label: '夏' },
];

const canPickDirectory =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const browseDirectory = async (): Promise<string | null> => {
  if (!canPickDirectory) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, title: globalT('选择文件夹') });
  return typeof selected === 'string' ? selected : null;
};

const DURATION_OPTIONS = [15, 25, 45, 60];
const BREAK_OPTIONS = [5, 10, 15];
const STUDY_GOAL_OPTIONS = [30, 50, 90, 120];

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="cozy-switch-row"
      onClick={() => onChange(!checked)}
    >
      <span className="cozy-switch" data-on={checked}>
        <span className="cozy-switch__thumb" />
      </span>
      <span className="cozy-switch-row__label">{label}</span>
    </button>
  );
}

const timeModes: { value: TimeMode; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'day', label: '白天' },
  { value: 'dusk', label: '黄昏' },
  { value: 'night', label: '夜晚' },
];

const weathers: { value: WeatherType; label: string }[] = [
  { value: 'clear', label: '晴' },
  { value: 'rain', label: '雨' },
  { value: 'snow', label: '雪' },
  { value: 'spring', label: '春' },
  { value: 'summer', label: '夏' },
];

export function SettingsPanel({ controls }: { controls: SceneControls }) {
  const t = useT();
  const { settings } = controls;
  const focus = useSettingsStore((state) => state.focus);
  const updateFocus = useSettingsStore((state) => state.updateFocus);
  const study = useSettingsStore((state) => state.study);
  const updateStudy = useSettingsStore((state) => state.updateStudy);
  const companion = useSettingsStore((state) => state.companion);
  const updateCompanion = useSettingsStore((state) => state.updateCompanion);
  const privacy = useSettingsStore((state) => state.privacy);
  const updatePrivacy = useSettingsStore((state) => state.updatePrivacy);
  const models = useSettingsStore((state) => state.models);
  const updateModels = useSettingsStore((state) => state.updateModels);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const updateLanguage = useSettingsStore((state) => state.updateLanguage);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const paths = useSettingsStore((state) => state.paths);
  const loaded = useSettingsStore((state) => state.loaded);
  const updatePaths = useSettingsStore((state) => state.updatePaths);
  const updatePath = useSettingsStore((state) => state.updatePath);
  const ambientFilesByWeather = useSettingsStore((state) => state.ambientFilesByWeather);
  const ambientModeByWeather = useSettingsStore((state) => state.ambientModeByWeather);
  const focusMusicFile = useSettingsStore((state) => state.focusMusicFile);
  const updateFocusMusic = useSettingsStore((state) => state.updateFocusMusic);
  const search = useSettingsStore((state) => state.search);
  const updateSearch = useSettingsStore((state) => state.updateSearch);

  const [followTime, setFollowTime] = useState(settings.timeMode === 'auto');
  const [displayName, setDisplayName] = useState(companion.displayName);
  const [musicDraft, setMusicDraft] = useState(paths.musicDir ?? '');
  const [readDirDraft, setReadDirDraft] = useState('');
  const [appPaths, setAppPaths] = useState<AppPathsInfo | null>(null);
  const [dataDirDraft, setDataDirDraft] = useState('');
  const [resourceDirDraft, setResourceDirDraft] = useState('');
  const [ambientError, setAmbientError] = useState('');
  const [focusMusicError, setFocusMusicError] = useState('');

  useEffect(() => {
    void getAppPaths().then(setAppPaths);
  }, []);

  // 设置读完后把已保存的存储地址/资源目录回填到输入框（未保存过则显示 Rust 侧有效值）
  useEffect(() => {
    if (!loaded) return;
    setDataDirDraft(paths.dataDir ?? appPaths?.dataDir ?? '');
    setResourceDirDraft(paths.resourceDir ?? appPaths?.resourceDir ?? '');
  }, [loaded, paths.dataDir, paths.resourceDir, appPaths]);

  /** 保存存储地址/资源目录：热替换。dataDir 切库后重载前端以读取新库数据 */
  const savePath = async (kind: 'dataDir' | 'resourceDir') => {
    const value = (kind === 'dataDir' ? dataDirDraft : resourceDirDraft).trim();
    if (!value) return;
    const ok = await updatePath(kind, value);
    if (ok && kind === 'dataDir' && canPickDirectory) {
      // 后端已热替换到新库，无需重启；重载前端加载新数据目录的数据
      window.location.reload();
    }
  };
  const [modelStatus, setModelStatus] = useState<Record<'small' | 'big', 'checking' | 'ok' | 'missing' | 'idle'>>(
    { small: 'idle', big: 'idle' },
  );
  /** 本机 Ollama 已安装的模型名（快速/教练模型下拉选项） */
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // 进设置就拉一次可用模型列表；Ollama 未运行则返回空，点「检查可用性」会再拉
  useEffect(() => {
    let cancelled = false;
    void listInstalledModels().then((models) => {
      if (!cancelled) setAvailableModels(models.map((m) => m.name));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const modelStatusText = (status: 'checking' | 'ok' | 'missing' | 'idle'): string =>
    status === 'checking'
      ? t('检查中…')
      : status === 'ok'
        ? t('可用')
        : status === 'missing'
          ? t('未安装')
          : t('未检查');

  const checkModels = async () => {
    setModelStatus({ small: 'checking', big: 'checking' });
    const [small, big, list] = await Promise.all([
      checkModelAvailable(models.small),
      checkModelAvailable(models.big),
      listInstalledModels(),
    ]);
    setAvailableModels(list.map((m) => m.name));
    setModelStatus({ small: small ? 'ok' : 'missing', big: big ? 'ok' : 'missing' });
  };

  // 设置读完后把已配置的音乐目录回填到输入框
  useEffect(() => {
    if (loaded) setMusicDraft(paths.musicDir ?? '');
  }, [loaded, paths.musicDir]);

  const saveMusicDir = async () => {
    const dir = musicDraft.trim();
    await updatePaths({ musicDir: dir || undefined });
    setMusicDraft(dir);
  };

  const browseMusicDir = async () => {
    const dir = await browseDirectory();
    if (dir) {
      setMusicDraft(dir);
      await updatePaths({ musicDir: dir });
    }
  };

  const addReadDir = async (draft: string) => {
    const dir = draft.trim();
    if (!dir) return;
    await updatePaths({ readDirs: [...paths.readDirs, dir] });
    setReadDirDraft('');
  };

  const removeReadDir = async (dir: string) => {
    await updatePaths({ readDirs: paths.readDirs.filter((item) => item !== dir) });
  };

  const browseReadDir = async () => {
    const dir = await browseDirectory();
    if (dir) await addReadDir(dir);
  };

  // 自定义背景音频：选文件 → 复制进数据目录（保证可读）→ 持久化 → 循环播放
  const [pickingAudio, setPickingAudio] = useState(false);

  const pickAmbientFile = async (weather: WeatherType) => {
    if (!canPickDirectory || pickingAudio) return;
    setPickingAudio(true);
    setAmbientError('');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        title: t('选择背景音频'),
        filters: [{ name: t('音频'), extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a'] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const readable = await invoke<string>('file_import_into_data_dir', { path });
        await controls.setAmbientFile(weather, readable);
      } catch {
        // 复制进数据目录失败时仍记录原路径，UI 可见；播放由 audio_read_imported 做许可校验
        await controls.setAmbientFile(weather, path);
        setAmbientError(t('已记录所选音频，但复制到数据目录失败，可能无法播放。'));
      }
    } catch {
      // 对话框或导入命令本身抛错
      setAmbientError(t('选择音频失败。'));
    } finally {
      setPickingAudio(false);
    }
  };

  const removeAmbientFile = async (weather: WeatherType) => {
    await controls.setAmbientFile(weather, undefined);
  };

  /** 专注模式专属背景音乐：选文件 → 复制进数据目录 → 持久化 */
  const pickFocusMusic = async () => {
    if (!canPickDirectory) return;
    setFocusMusicError('');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        title: t('选择专注背景音乐'),
        filters: [{ name: t('音频'), extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a'] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      const { invoke } = await import('@tauri-apps/api/core');
      const readable = await invoke<string>('file_import_into_data_dir', { path });
      await updateFocusMusic(readable);
    } catch {
      // 复制失败仍记录原路径，播放由 audio_read_imported 做许可校验
      setFocusMusicError(t('选择文件失败，或复制到数据目录失败。'));
    }
  };

  const removeFocusMusic = async () => {
    await updateFocusMusic(undefined);
  };

  return (
    <div className="cozy-settings">
      {/* ---- 场景（视觉偏好，本地） ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('场景')}</h3>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('默认场景')}</span>
          <div className="cozy-segmented cozy-segmented--tight" role="group" aria-label={t('默认场景')}>
            <button
              type="button"
              className="cozy-segmented__item"
              data-active={settings.sceneId === 'study-room'}
              aria-pressed={settings.sceneId === 'study-room'}
              onClick={() => controls.setScene('study-room')}
            >
              {t('房间')}
            </button>
            <button
              type="button"
              className="cozy-segmented__item"
              data-active={settings.sceneId === 'library'}
              aria-pressed={settings.sceneId === 'library'}
              onClick={() => controls.setScene('library')}
            >
              {t('图书馆')}
            </button>
          </div>
        </div>

        <Switch
          label={t('跟随本地时间')}
          checked={followTime}
          onChange={(checked) => {
            setFollowTime(checked);
            controls.setTimeMode(checked ? 'auto' : controls.timePhase);
          }}
        />

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('时间预览')}</span>
          <div className="cozy-segmented cozy-segmented--tight" role="group" aria-label={t('时间预览')}>
            {timeModes.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className="cozy-segmented__item"
                data-active={settings.timeMode === value}
                aria-pressed={settings.timeMode === value}
                onClick={() => {
                  setFollowTime(value === 'auto');
                  controls.setTimeMode(value);
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('天气')}</span>
          <div className="cozy-segmented cozy-segmented--tight" role="group" aria-label={t('天气')}>
            {weathers.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className="cozy-segmented__item"
                data-active={settings.weather === value}
                aria-pressed={settings.weather === value}
                onClick={() => controls.setWeather(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('背景音乐')}</span>
          <span className="cozy-settings-row__value">{t('按环境分别配置')}</span>
        </div>
        {weatherRows.map(({ weather, label }) => {
          const setting = settings.ambientByWeather[weather];
          const file = ambientFilesByWeather[weather];
          // 模式以持久化的 ambientModeByWeather 为准（与文件同库），场景状态已回灌
          const mode = ambientModeByWeather[weather] ?? setting?.mode ?? 'builtin';
          return (
            <div className="cozy-settings-row" key={weather}>
              <span className="cozy-settings-row__label">{t(label)}</span>
              <select
                className="cozy-model-field__input"
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as AmbientMode;
                  controls.setAmbientMode(weather, next);
                  // 已有文件时切到「自定义」不重复弹选择框，直接显示已存文件
                  if (next === 'custom' && !file) void pickAmbientFile(weather);
                }}
              >
                <option value="builtin">{t('内置')}</option>
                <option value="none">{t('无')}</option>
                <option value="custom">{t('自定义')}</option>
              </select>
              {mode === 'custom' ? (
                <span className="cozy-ambient-file">
                  {file ? (
                    <code title={file}>{file.split(/[\\/]/).pop()}</code>
                  ) : (
                    <span className="cozy-companion-panel__hint">
                      {canPickDirectory ? t('未选择文件') : t('桌面端（Tauri）可选择本地音频')}
                    </span>
                  )}
                  {ambientError ? (
                    <span className="cozy-today-error">{ambientError}</span>
                  ) : null}
                  <button
                    type="button"
                    className="cozy-btn-secondary"
                    disabled={!canPickDirectory || pickingAudio}
                    title={canPickDirectory ? undefined : t('桌面端（Tauri）可用')}
                    onClick={() => void pickAmbientFile(weather)}
                  >
                    {pickingAudio ? t('选择中…') : file ? t('更换') : t('选择音频…')}
                  </button>
                  {file ? (
                    <button
                      type="button"
                      className="cozy-btn-ghost"
                      onClick={() => void removeAmbientFile(weather)}
                    >
                      {t('移除')}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })}
        <p className="cozy-companion-panel__hint">
          {t('内置：雨天雨声、雪天雪声、晴天晴日。每个环境可选「自定义」并各自选择一首本地音频（mp3 / flac / wav / ogg / m4a），循环播放作为该环境的背景音乐；选「无」则该环境没有背景音乐。')}
        </p>

        <div className="cozy-slider-row">
          <label className="cozy-slider-row__label" htmlFor="scene-brightness">{t('场景亮度')}</label>
          <input
            id="scene-brightness"
            className="cozy-slider"
            type="range"
            min={55}
            max={100}
            value={settings.brightness}
            onChange={(event) => controls.setBrightness(Number(event.target.value))}
          />
          <span className="cozy-slider-row__value">{settings.brightness}%</span>
        </div>

        <Switch
          label={t('显示环境动画')}
          checked={settings.envAnimation}
          onChange={controls.setEnvAnimation}
        />
        <Switch
          label={t('减少动态效果')}
          checked={settings.reducedMotion}
          onChange={controls.setReducedMotion}
        />
      </section>

      {/* ---- 专注（真实） ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('专注')}</h3>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('默认时长')}</span>
          <div className="cozy-segmented cozy-segmented--tight" role="group" aria-label={t('默认时长')}>
            {DURATION_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="cozy-segmented__item"
                data-active={focus.defaultDurationMinutes === minutes}
                aria-pressed={focus.defaultDurationMinutes === minutes}
                onClick={() => void updateFocus({ defaultDurationMinutes: minutes })}
              >
                {minutes}
              </button>
            ))}
          </div>
        </div>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('休息时长')}</span>
          <div className="cozy-segmented cozy-segmented--tight" role="group" aria-label={t('休息时长')}>
            {BREAK_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="cozy-segmented__item"
                data-active={focus.breakDurationMinutes === minutes}
                aria-pressed={focus.breakDurationMinutes === minutes}
                onClick={() => void updateFocus({ breakDurationMinutes: minutes })}
              >
                {t('{0} 分', minutes)}
              </button>
            ))}
          </div>
        </div>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('每日学习目标')}</span>
          <div className="cozy-segmented cozy-segmented--tight" role="group" aria-label={t('每日学习目标')}>
            {STUDY_GOAL_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="cozy-segmented__item"
                data-active={study.dailyGoalMinutes === minutes}
                aria-pressed={study.dailyGoalMinutes === minutes}
                onClick={() => void updateStudy({ dailyGoalMinutes: minutes })}
              >
                {t('{0} 分', minutes)}
              </button>
            ))}
          </div>
        </div>

        <Switch
          label={t('结束时提示音')}
          checked={focus.completionCue}
          onChange={(checked) => void updateFocus({ completionCue: checked })}
        />

        <Switch
          label={t('专注时保持安静')}
          checked={focus.quietDuringFocus}
          onChange={(checked) => void updateFocus({ quietDuringFocus: checked })}
        />

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('专注背景音乐')}</span>
          {focusMusicFile ? (
            <span className="cozy-ambient-file">
              <code title={focusMusicFile}>{focusMusicFile.split(/[\\/]/).pop()}</code>
              <button
                type="button"
                className="cozy-btn-secondary"
                disabled={!canPickDirectory}
                onClick={() => void pickFocusMusic()}
              >
                {t('更换')}
              </button>
              <button
                type="button"
                className="cozy-btn-ghost"
                onClick={() => void removeFocusMusic()}
              >
                {t('移除')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="cozy-btn-secondary"
              disabled={!canPickDirectory}
              onClick={() => void pickFocusMusic()}
            >
              {canPickDirectory ? t('选择音乐…') : t('桌面端（Tauri）可选择本地音频')}
            </button>
          )}
        </div>
        {focusMusicError ? <p className="cozy-today-error">{focusMusicError}</p> : null}
        <p className="cozy-companion-panel__hint">
          {t('专注全屏界面里的背景音乐，单独配置，与天气环境音互不影响。')}
        </p>
      </section>

      {/* ---- 陪伴（真实 + 视觉） ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('陪伴')}</h3>
        <Switch
          label={t('启用陪伴角色')}
          checked={companion.enabled}
          onChange={(checked) => void updateCompanion({ enabled: checked })}
        />
        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('显示名称')}</span>
          <input
            className="cozy-model-field__input"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => {
              if (displayName.trim() && displayName !== companion.displayName) {
                void updateCompanion({ displayName: displayName.trim() });
              }
            }}
          />
        </div>
        <Switch
          label={t('显示小宠物（场景）')}
          checked={settings.showPet}
          onChange={controls.setShowPet}
        />
        <Switch
          label={t('允许宠物自动休息')}
          checked={settings.petAutoRest}
          onChange={controls.setPetAutoRest}
        />
        <Switch
          label={t('宠物专注时保持安静')}
          checked={settings.petQuietInFocus}
          onChange={controls.setPetQuietInFocus}
        />
      </section>

      {/* ---- 路径（真实）：存储地址 + 音乐目录 + 读取目录 ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('路径')}</h3>
        <p className="cozy-companion-panel__hint">
          {t('数据（任务、笔记、复盘、设置、日志）存数据目录；下面几项都可编辑并保存到本地。')}
        </p>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('存储地址')}</span>
          <input
            className="cozy-model-field__input"
            type="text"
            placeholder={t('应用数据目录')}
            value={dataDirDraft}
            onChange={(event) => setDataDirDraft(event.target.value)}
          />
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={!dataDirDraft.trim()}
            onClick={() => void savePath('dataDir')}
          >
            {t('保存')}
          </button>
        </div>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('资源目录')}</span>
          <input
            className="cozy-model-field__input"
            type="text"
            placeholder={t('应用资源目录')}
            value={resourceDirDraft}
            onChange={(event) => setResourceDirDraft(event.target.value)}
          />
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={!resourceDirDraft.trim()}
            onClick={() => void savePath('resourceDir')}
          >
            {t('保存')}
          </button>
        </div>
        <p className="cozy-companion-panel__hint">
          {t('存储地址改动会连同数据库/导入/备份一起迁移并立即切换；资源目录改动即时生效。')}
        </p>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('音乐目录')}</span>
          <input
            className="cozy-model-field__input"
            type="text"
            placeholder={t('手动输入目录，或点浏览')}
            value={musicDraft}
            onChange={(event) => setMusicDraft(event.target.value)}
          />
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={!musicDraft.trim()}
            onClick={() => void saveMusicDir()}
          >
            {t('保存')}
          </button>
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={!canPickDirectory}
            title={canPickDirectory ? undefined : t('桌面端（Tauri）可用')}
            onClick={() => void browseMusicDir()}
          >
            {t('浏览…')}
          </button>
        </div>

        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('读取目录（导入文档用）')}</span>
          {paths.readDirs.length > 0 ? (
            <div className="cozy-path-list">
              {paths.readDirs.map((dir) => (
                <span key={dir} className="cozy-path-chip">
                  <code>{dir}</code>
                  <button type="button" aria-label={t('移除 {0}', dir)} onClick={() => void removeReadDir(dir)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="cozy-companion-panel__hint">{t('未配置。添加后这些目录下的文件也能导入。')}</span>
          )}
        </div>
        <p className="cozy-companion-panel__hint">
          {t('含义：添加目录后，「知识」页导入时可以从这些目录读取文档（支持 PDF / Markdown / TXT / EPUB / MOBI / AZW3），读入的内容会切成片段并建立索引，供检索与 AI 整理使用。')}
        </p>
        <div className="cozy-settings-row">
          <input
            className="cozy-model-field__input"
            type="text"
            placeholder={t('手动输入目录，或点浏览')}
            value={readDirDraft}
            onChange={(event) => setReadDirDraft(event.target.value)}
          />
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={!readDirDraft.trim()}
            onClick={() => void addReadDir(readDirDraft)}
          >
            {t('添加')}
          </button>
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={!canPickDirectory}
            title={canPickDirectory ? undefined : t('桌面端（Tauri）可用')}
            onClick={() => void browseReadDir()}
          >
            {t('浏览…')}
          </button>
        </div>
      </section>

      {/* ---- 隐私（真实） ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('隐私')}</h3>
        <Switch
          label={t('允许外部搜索')}
          checked={privacy.allowExternalSearch}
          onChange={(checked) => void updatePrivacy({ allowExternalSearch: checked })}
        />
        <Switch
          label={t('每次联网都问我')}
          checked={privacy.requireConfirmationPerRequest}
          onChange={(checked) =>
            void updatePrivacy({ requireConfirmationPerRequest: checked })
          }
        />
      </section>

      {/* ---- 搜索（真实） ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('搜索')}</h3>
        <p className="cozy-companion-panel__hint">
          {t('本地优先，搜不到时用外部搜索引擎补充。只发关键词，不发笔记原文。')}
        </p>
        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('搜索引擎')}</span>
          <select
            className="cozy-model-field__input"
            value={search.id}
            onChange={(event) =>
              void updateSearch({ id: event.target.value as SearchEngineConfig['id'] })
            }
          >
            {ENGINE_LIST.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>
        </div>
        {search.id === 'custom' ? (
          <>
            <div className="cozy-settings-row">
              <span className="cozy-settings-row__label">{t('搜索 URL')}</span>
              <input
                className="cozy-model-field__input"
                value={search.customUrl ?? ''}
                placeholder="https://www.baidu.com/s?wd={query}"
                onChange={(event) => void updateSearch({ customUrl: event.target.value })}
              />
            </div>
            <div className="cozy-settings-row">
              <span className="cozy-settings-row__label">{t('引擎名称')}</span>
              <input
                className="cozy-model-field__input"
                value={search.customLabel ?? ''}
                placeholder={t('我的搜索')}
                onChange={(event) =>
                  void updateSearch({ customLabel: event.target.value || undefined })
                }
              />
            </div>
          </>
        ) : null}
        <p className="cozy-companion-panel__hint">
          {t('URL 里用 {0} 代替检索词。外部搜索需要打开「允许外部搜索」开关。', '{query}')}
        </p>
      </section>

      {/* ---- 模型 / 主题（真实） ---- */}
      <section className="cozy-settings__group">
        <h3 className="cozy-settings__group-title">{t('模型与外观')}</h3>
        <div className="cozy-model-field">
          <label htmlFor="quick-model">{t('快速模型')}</label>
          <input
            id="quick-model"
            className="cozy-model-field__input"
            type="text"
            list="quick-model-list"
            value={models.small}
            placeholder={t('输入模型名，如 qwen2.5:1.5b')}
            onChange={(event) => void updateModels({ small: event.target.value })}
          />
          <datalist id="quick-model-list">
            {availableModels.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="cozy-model-field">
          <label htmlFor="coach-model">{t('教练模型')}</label>
          <input
            id="coach-model"
            className="cozy-model-field__input"
            type="text"
            list="coach-model-list"
            value={models.big}
            placeholder={t('输入模型名，如 qwen2.5:14b')}
            onChange={(event) => void updateModels({ big: event.target.value })}
          />
          <datalist id="coach-model-list">
            {availableModels.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('测试模型')}</span>
          <span className="cozy-settings-row__value">
            {t('快速 {0} · 教练 {1}', modelStatusText(modelStatus.small), modelStatusText(modelStatus.big))}
          </span>
          <button
            type="button"
            className="cozy-btn-secondary"
            disabled={modelStatus.small === 'checking' || modelStatus.big === 'checking'}
            onClick={() => void checkModels()}
          >
            {t('检查可用性')}
          </button>
        </div>
        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('主题')}</span>
          <select
            className="cozy-model-field__input"
            value={theme}
            onChange={(event) => void setTheme(event.target.value as ThemeMode)}
          >
            <option value="system">{t('跟随系统')}</option>
            <option value="light">{t('浅色')}</option>
            <option value="dark">{t('深色')}</option>
          </select>
        </div>
        <div className="cozy-settings-row">
          <span className="cozy-settings-row__label">{t('界面语言')}</span>
          <select
            className="cozy-model-field__input"
            value={language}
            onChange={(event) => void updateLanguage(event.target.value as AppLanguage)}
          >
            <option value="zh">{t('中文')}</option>
            <option value="en">{t('English')}</option>
          </select>
        </div>
        <p className="cozy-companion-panel__hint">
          {aiMode === 'template'
            ? t('当前是模板模式：任务拆解按标点切分、复盘模板填空，没有模型参与。桌面端（Tauri）配好 Ollama 后即为模型模式。')
            : t('当前接入本地模型（Ollama）。')}
        </p>
      </section>
    </div>
  );
}
