/**
 * 设置 store
 *
 * 这是之前缺失的一环：设置页有开关，但改动只活在组件的局部 state 里，
 * 没有任何人往 settings 表写。切页面或重启就回到默认值 —— 表现出来
 * 就是「设置没有存储」。
 *
 * 设计取舍：
 * - settings 表是 key/value 文本表，这里做扁平化：`focus.defaultDurationMinutes`
 *   这样加一项配置不需要迁移数据库。
 * - PrivacyPolicy 是唯一裁决者，所以 load() 会把落库的值灌回策略对象，
 *   而不是让 store 再存一份可能不一致的副本。
 * - 每次改动立即落库，不设「保存」按钮：开关类设置等用户再点一次保存
 *   很容易丢改动。
 */
import { create } from 'zustand';
import type { AppLanguage, CompanionConfig, FocusConfig, StudyConfig, ThemeMode } from '@shared-types/config';
import { defaultAppConfig } from '@shared-types/config';
import type { SearchEngineConfig } from '@shared-types/search-config';
import { defaultSearchEngineConfig } from '@shared-types/search-config';
import type { PrivacySettings } from '@application/policies/privacy-policy';
import { defaultPrivacySettings } from '@application/policies/privacy-policy';
import { getModelConfig, setModelConfig } from '@ai/router/model-config';
import { setSearchConfig } from '@ai/search/search-config';
import { setAppPaths, updateAppPaths } from '@infrastructure/paths/paths-api';
import { describeError, policies, repositories, runtime } from './runtime';

/** 扁平化的存储键。改名等于丢用户配置，别随手改 */
const KEYS = {
  privacyAllowExternalSearch: 'privacy.allowExternalSearch',
  privacyRequireConfirmation: 'privacy.requireConfirmationPerRequest',
  companionEnabled: 'companion.enabled',
  companionDisplayName: 'companion.displayName',
  companionAssetBase: 'companion.assetBase',
  companionBackgroundAsset: 'companion.backgroundAsset',
  focusDefaultDuration: 'focus.defaultDurationMinutes',
  focusBreakDuration: 'focus.breakDurationMinutes',
  focusCompletionCue: 'focus.completionCue',
  focusQuietDuringFocus: 'focus.quietDuringFocus',
  studyDailyGoal: 'study.dailyGoalMinutes',
  appLanguage: 'app.language',
  appearanceTheme: 'appearance.theme',
  searchEngineId: 'search.engineId',
  searchCustomUrl: 'search.customUrl',
  searchCustomLabel: 'search.customLabel',
  searchGoogleApiKey: 'search.googleApiKey',
  searchGoogleCx: 'search.googleCx',
  pathsReadDirs: 'paths.readDirs',
  pathsMusicDir: 'paths.musicDir',
  pathsDataDir: 'paths.dataDir',
  pathsResourceDir: 'paths.resourceDir',
  modelsSmall: 'models.small',
  modelsBig: 'models.big',
  modelsProviderMode: 'models.providerMode',
  modelsApiKey: 'models.apiKey',
  modelsDeepseekModel: 'models.deepseekModel',
  modelsDeepseekThinking: 'models.deepseekThinking',
  ambientFilesByWeather: 'ambient.filesByWeather',
  ambientModeByWeather: 'ambient.modeByWeather',
  /** 专注模式专属背景音乐文件路径（与天气环境音分开配置） */
  focusMusicFile: 'focus.musicFile',
} as const;

const asBoolean = (raw: string | undefined, fallback: boolean): boolean =>
  raw === undefined ? fallback : raw === 'true';

const asNumber = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** 把主题真正写到 <html data-theme>：light/dark 显式指定，system 走 prefers-color-scheme */
const applyTheme = (theme: ThemeMode): void => {
  if (typeof document === 'undefined') return;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
};

const asStringArray = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const asStringRecord = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
};

/** 用户配置的目录：可读目录 + 音乐目录 + 存储地址/资源目录（覆盖值） */
export interface PathsConfig {
  readDirs: string[];
  musicDir?: string;
  dataDir?: string;
  resourceDir?: string;
}

/** 双模型配置：大模型跑复盘/教练类，小模型跑快速任务（Ollama 模型名） */
export interface ModelsConfig {
  /** 快速任务的本地小模型（Ollama 模型名） */
  small: string;
  /** 本地大模型（未配 DeepSeek 时 coach/deep 的兜底） */
  big: string;
  /** 教练档用本地还是 DeepSeek 云端 */
  providerMode: 'local' | 'deepseek';
  /** DeepSeek API key（明文存本地 SQLite；配了才启用云端） */
  apiKey?: string;
  /** DeepSeek 档位：deepseek-v4-flash / deepseek-v4-pro */
  deepseekModel: string;
  /** DeepSeek 思考模式：true 走 thinking（更强但更慢更贵） */
  deepseekThinking: boolean;
}

interface SettingsState {
  privacy: PrivacySettings;
  companion: CompanionConfig;
  focus: FocusConfig;
  study: StudyConfig;
  language: AppLanguage;
  theme: ThemeMode;
  search: SearchEngineConfig;
  paths: PathsConfig;
  models: ModelsConfig;
  /** 各环境自定义背景音频文件路径（weather → 文件路径），每个环境各自一首 */
  ambientFilesByWeather: Record<string, string>;
  /** 各环境背景音乐模式（weather → mode），与文件同库持久化，重启不丢 */
  ambientModeByWeather: Record<string, string>;
  /** 专注模式专属背景音乐文件路径（与天气环境音分开配置） */
  focusMusicFile?: string;
  /** 首次读取完成前 UI 不该显示默认值，避免开关闪一下再跳回去 */
  loaded: boolean;
  error?: string;

  load: () => Promise<void>;
  updatePrivacy: (patch: Partial<PrivacySettings>) => Promise<void>;
  updateCompanion: (patch: Partial<CompanionConfig>) => Promise<void>;
  updateFocus: (patch: Partial<FocusConfig>) => Promise<void>;
  updateStudy: (patch: Partial<StudyConfig>) => Promise<void>;
  updateLanguage: (language: AppLanguage) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  updateSearch: (patch: Partial<SearchEngineConfig>) => Promise<void>;
  updatePaths: (patch: Partial<PathsConfig>) => Promise<void>;
  updateModels: (patch: Partial<ModelsConfig>) => Promise<void>;
  /** 修改存储地址/资源目录（热替换，无需重启）；返回是否应用成功 */
  updatePath: (kind: 'dataDir' | 'resourceDir', value: string) => Promise<boolean>;
  /** 设置某个环境的背景音乐模式（与文件同库持久化） */
  updateAmbientMode: (weather: string, mode: string) => Promise<void>;
  /** 设置某个环境的自定义背景音频文件；file 传 undefined 表示移除 */
  updateAmbientFile: (weather: string, file?: string) => Promise<void>;
  /** 设置专注模式专属背景音乐；file 传 undefined 表示移除 */
  updateFocusMusic: (file?: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  /** 写一组键值（一个事务内完成，中途失败不留半组），undefined 表示「存空串」 */
  const persist = async (entries: Record<string, string | undefined>): Promise<void> => {
    const defined: Record<string, string> = {};
    for (const [key, value] of Object.entries(entries)) {
      defined[key] = value ?? '';
    }
    await repositories.settings.setMany(defined);
  };

  return {
    privacy: defaultPrivacySettings,
    companion: defaultAppConfig.appearance.companion,
    focus: defaultAppConfig.focus,
    study: defaultAppConfig.study,
    language: defaultAppConfig.language,
    theme: defaultAppConfig.appearance.theme,
    search: defaultSearchEngineConfig,
    paths: { readDirs: [] },
    models: { small: getModelConfig().small, big: getModelConfig().big, providerMode: 'local', deepseekModel: 'deepseek-v4-flash', deepseekThinking: false },
    ambientFilesByWeather: {},
    ambientModeByWeather: {},
    focusMusicFile: undefined,
    loaded: false,

    load: async () => {
      try {
        const stored = await repositories.settings.getAll();

        const privacy: PrivacySettings = {
          allowExternalSearch: asBoolean(
            stored[KEYS.privacyAllowExternalSearch],
            defaultPrivacySettings.allowExternalSearch
          ),
          requireConfirmationPerRequest: asBoolean(
            stored[KEYS.privacyRequireConfirmation],
            defaultPrivacySettings.requireConfirmationPerRequest
          ),
        };

        // 策略对象是唯一裁决者，落库的值必须回灌，否则重启后
        // 界面显示「允许联网」而策略仍在拒绝。
        policies.privacy.update(privacy);

        const companionDefaults = defaultAppConfig.appearance.companion;
        const focusDefaults = defaultAppConfig.focus;

        const paths: PathsConfig = {
          readDirs: asStringArray(stored[KEYS.pathsReadDirs]),
          musicDir: stored[KEYS.pathsMusicDir] || undefined,
          dataDir: stored[KEYS.pathsDataDir] || undefined,
          resourceDir: stored[KEYS.pathsResourceDir] || undefined,
        };

        // 路径许可在 Rust 侧，先回灌再让 UI 看到 paths，
        // 否则专注页先拉音乐列表时 Rust 还不知道目录
        await updateAppPaths(paths.readDirs, paths.musicDir).catch(() => undefined);

        set({
          privacy,
          companion: {
            companionId: companionDefaults.companionId,
            enabled: asBoolean(stored[KEYS.companionEnabled], companionDefaults.enabled),
            displayName: stored[KEYS.companionDisplayName] || companionDefaults.displayName,
            assetBase: stored[KEYS.companionAssetBase] || companionDefaults.assetBase,
            backgroundAsset: stored[KEYS.companionBackgroundAsset] || undefined,
          },
          focus: {
            defaultDurationMinutes: asNumber(
              stored[KEYS.focusDefaultDuration],
              focusDefaults.defaultDurationMinutes
            ),
            breakDurationMinutes: asNumber(
              stored[KEYS.focusBreakDuration],
              focusDefaults.breakDurationMinutes
            ),
            completionCue: asBoolean(stored[KEYS.focusCompletionCue], focusDefaults.completionCue),
            quietDuringFocus: asBoolean(
              stored[KEYS.focusQuietDuringFocus],
              focusDefaults.quietDuringFocus
            ),
          },
          study: {
            dailyGoalMinutes: asNumber(stored[KEYS.studyDailyGoal], defaultAppConfig.study.dailyGoalMinutes),
          },
          language: (stored[KEYS.appLanguage] as AppLanguage) || defaultAppConfig.language,
          theme: (stored[KEYS.appearanceTheme] as ThemeMode) || defaultAppConfig.appearance.theme,
          search: {
            id: (stored[KEYS.searchEngineId] as SearchEngineConfig['id']) || defaultSearchEngineConfig.id,
            googleApiKey: stored[KEYS.searchGoogleApiKey] || undefined,
            googleCx: stored[KEYS.searchGoogleCx] || undefined,
          },
          paths,
          models: {
            small: stored[KEYS.modelsSmall] || getModelConfig().small,
            big: stored[KEYS.modelsBig] || getModelConfig().big,
            providerMode: (stored[KEYS.modelsProviderMode] as 'local' | 'deepseek') || getModelConfig().providerMode,
            apiKey: stored[KEYS.modelsApiKey] || undefined,
            deepseekModel: stored[KEYS.modelsDeepseekModel] || getModelConfig().deepseekModel,
            deepseekThinking: stored[KEYS.modelsDeepseekThinking] === 'true' || getModelConfig().deepseekThinking,
          },
          ambientFilesByWeather: asStringRecord(stored[KEYS.ambientFilesByWeather]),
          ambientModeByWeather: asStringRecord(stored[KEYS.ambientModeByWeather]),
          focusMusicFile: stored[KEYS.focusMusicFile] || undefined,
          loaded: true,
        });

        // 搜索引擎配置是 SearchGate 的模块单例，启动加载后回灌一次
        setSearchConfig(get().search);
        // 双模型配置是 ModelRouter 的模块单例，同样回灌一次
        setModelConfig(get().models);
        // DeepSeek provider 热配置：key 注入后教练档自动走云端（无需重启）
        runtime.deepseek.configure({
          apiKey: get().models.apiKey,
          model: get().models.deepseekModel,
          thinking: get().models.deepseekThinking,
        });
        // 主题真正落到 <html data-theme>
        applyTheme(get().theme);
      } catch (error) {
        // 读失败也要放行 UI，否则设置页会一直卡在加载态
        set({ error: describeError(error), loaded: true });
      }
    },

    updatePrivacy: async (patch) => {
      const next = { ...get().privacy, ...patch };
      policies.privacy.update(next);
      set({ privacy: next, error: undefined });

      try {
        await persist({
          [KEYS.privacyAllowExternalSearch]: String(next.allowExternalSearch),
          [KEYS.privacyRequireConfirmation]: String(next.requireConfirmationPerRequest),
        });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateCompanion: async (patch) => {
      const next = { ...get().companion, ...patch };
      set({ companion: next, error: undefined });

      try {
        await persist({
          [KEYS.companionEnabled]: String(next.enabled),
          [KEYS.companionDisplayName]: next.displayName,
          [KEYS.companionAssetBase]: next.assetBase,
          [KEYS.companionBackgroundAsset]: next.backgroundAsset,
        });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateFocus: async (patch) => {
      const next = { ...get().focus, ...patch };
      set({ focus: next, error: undefined });

      try {
        await persist({
          [KEYS.focusDefaultDuration]: String(next.defaultDurationMinutes),
          [KEYS.focusBreakDuration]: String(next.breakDurationMinutes),
          [KEYS.focusCompletionCue]: String(next.completionCue),
          [KEYS.focusQuietDuringFocus]: String(next.quietDuringFocus),
        });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateStudy: async (patch) => {
      const next = { ...get().study, ...patch };
      set({ study: next, error: undefined });
      try {
        await persist({
          [KEYS.studyDailyGoal]: String(next.dailyGoalMinutes),
        });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateLanguage: async (language) => {
      set({ language, error: undefined });
      try {
        await persist({ [KEYS.appLanguage]: language });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    setTheme: async (theme) => {
      set({ theme, error: undefined });
      applyTheme(theme);
      try {
        await persist({ [KEYS.appearanceTheme]: theme });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateSearch: async (patch) => {
      const next = { ...get().search, ...patch };
      set({ search: next, error: undefined });
      // 立刻让 SearchGate 用新引擎，不用重启
      setSearchConfig(next);

      try {
        await persist({
          [KEYS.searchEngineId]: next.id,
          [KEYS.searchGoogleApiKey]: next.googleApiKey ?? '',
          [KEYS.searchGoogleCx]: next.googleCx ?? '',
        });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updatePaths: async (patch) => {
      const next = { ...get().paths, ...patch };
      set({ paths: next, error: undefined });

      try {
        await persist({
          [KEYS.pathsReadDirs]: JSON.stringify(next.readDirs),
          [KEYS.pathsMusicDir]: next.musicDir ?? '',
        });
        // Rust 侧的路径许可同步更新，配置的目录立即可用于导入/音乐
        await updateAppPaths(next.readDirs, next.musicDir);
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updatePath: async (kind, value) => {
      const trimmed = value.trim();
      const next = { ...get().paths, [kind]: trimmed || undefined };
      set({ paths: next, error: undefined });

      try {
        const key = kind === 'dataDir' ? KEYS.pathsDataDir : KEYS.pathsResourceDir;
        await persist({ [key]: trimmed });
        // 覆盖值写进 Rust 侧 paths.json；dataDir 变化会迁移数据并热替换到新库
        await setAppPaths({ [kind]: trimmed || undefined }, { migrate: true });
        return true;
      } catch (error) {
        set({ error: describeError(error) });
        return false;
      }
    },

    updateAmbientMode: async (weather, mode) => {
      const next = { ...get().ambientModeByWeather, [weather]: mode };
      set({ ambientModeByWeather: next, error: undefined });
      try {
        await persist({ [KEYS.ambientModeByWeather]: JSON.stringify(next) });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateFocusMusic: async (file) => {
      set({ focusMusicFile: file, error: undefined });
      try {
        await persist({ [KEYS.focusMusicFile]: file ?? '' });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateModels: async (patch) => {
      const next = { ...get().models, ...patch };
      set({ models: next, error: undefined });
      // ModelRouter 模块单例同步更新，换模型无需重启
      setModelConfig(next);
      // DeepSeek provider 热配置：key/档位变化立即生效
      runtime.deepseek.configure({
        apiKey: next.apiKey,
        model: next.deepseekModel,
        thinking: next.deepseekThinking,
      });

      try {
        await persist({
          [KEYS.modelsSmall]: next.small,
          [KEYS.modelsBig]: next.big,
          [KEYS.modelsProviderMode]: next.providerMode,
          [KEYS.modelsApiKey]: next.apiKey ?? '',
          [KEYS.modelsDeepseekModel]: next.deepseekModel,
          [KEYS.modelsDeepseekThinking]: String(next.deepseekThinking),
        });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },

    updateAmbientFile: async (weather, file) => {
      const next = { ...get().ambientFilesByWeather };
      if (file) next[weather] = file;
      else delete next[weather];
      set({ ambientFilesByWeather: next, error: undefined });
      try {
        await persist({ [KEYS.ambientFilesByWeather]: JSON.stringify(next) });
      } catch (error) {
        set({ error: describeError(error) });
      }
    },
  };
});
