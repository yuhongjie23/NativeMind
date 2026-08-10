/**
 * 搜索引擎配置单例
 *
 * 运行时在 `startRuntime()` 之前构建，那时 settings 表可能还没迁移，
 * 所以这里不能在建 gate 时直接读库。改成模块级可变配置：
 * settings-store 加载/变更时 `setSearchConfig`，SearchGate 每次搜索用
 * `getSearchConfig` 现取 —— 用户切引擎无需重启即生效。
 */
import {
  defaultSearchEngineConfig,
  type SearchEngineConfig,
} from '@shared-types/search-config';

let current: SearchEngineConfig = defaultSearchEngineConfig;

export const getSearchConfig = (): SearchEngineConfig => current;

export const setSearchConfig = (config: SearchEngineConfig): void => {
  current = config;
};
