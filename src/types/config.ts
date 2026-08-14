/**
 * 配置类型
 *
 * 分成三块：外观（含宠物与背景，后续要换资源）、专注默认值、隐私。
 * 全部有默认值，第一次启动不需要用户填任何东西。
 */
import type { PrivacySettings } from '@application/policies/privacy-policy';
import type { SearchEngineConfig } from './search-config';

export type ThemeMode = 'light' | 'dark' | 'system';

/** 应用语言：中文为源，英文由 i18n 覆盖表提供 */
export type AppLanguage = 'zh' | 'en';

/**
 * 陪伴角色与背景配置
 *
 * 默认加载内置芙莉莲 Sprite Sheet；把 assetBase 指到其他资源目录即可换角色，
 * 组件侧不用改：CompanionWidget 已经按插槽方式渲染。
 */
export interface CompanionConfig {
  companionId: string;
  displayName: string;
  /** 资源根目录，留空表示用内置 CSS 占位形象 */
  assetBase?: string;
  /** 场景背景图，留空表示用纯色渐变 */
  backgroundAsset?: string;
  /** 关掉后宠物不出现，也不发起互动 */
  enabled: boolean;
}

export interface AppearanceConfig {
  theme: ThemeMode;
  companion: CompanionConfig;
  /** 减少动画，配合系统的 prefers-reduced-motion */
  reducedMotion: boolean;
}

export interface FocusConfig {
  defaultDurationMinutes: number;
  /** 专注结束后的休息时长（分钟），番茄钟节奏用 */
  breakDurationMinutes: number;
  /** 专注结束时的提示音，来自 audio-library 的 cue */
  completionCue: boolean;
  /** 专注时保持安静（默认 true）：专注中停掉环境音/音乐，只留专注音乐；false 则环境音继续 */
  quietDuringFocus: boolean;
}

/** 学习习惯配置：每日打卡的学习目标 */
export interface StudyConfig {
  /** 每日学习目标分钟数，打卡学习进度 = 当日专注分钟 / 目标 */
  dailyGoalMinutes: number;
}

export interface AppConfig {
  appearance: AppearanceConfig;
  focus: FocusConfig;
  study: StudyConfig;
  privacy: Partial<PrivacySettings>;
  search: Partial<SearchEngineConfig>;
  /** 界面语言，Flora 写信也按此回信 */
  language: AppLanguage;
}

export const defaultAppConfig: AppConfig = {
  appearance: {
    theme: 'system',
    companion: {
      companionId: 'fulilian',
      displayName: '芙莉莲',
      assetBase: '/companions/fulilian/animations',
      enabled: true,
    },
    reducedMotion: false,
  },
  focus: {
    defaultDurationMinutes: 25,
    breakDurationMinutes: 5,
    completionCue: true,
    quietDuringFocus: true,
  },
  study: {
    dailyGoalMinutes: 50,
  },
  privacy: {},
  search: { id: 'bing' },
  language: 'zh',
};
