/**
 * 双模型配置单例
 *
 * 运行时在 settings 加载前就构建，所以模型名不能只读库。
 * 这里用模块级可变配置：settings-store 加载/变更时 `setModelConfig`，
 * ModelRouter 每次调用用 `resolveModel` 现取 —— 用户换模型无需重启。
 *
 * 映射：fast → 小模型（默认 1.5B），coach / deep → 大模型（默认 14B）。
 * 每日复盘走 coach、每周复盘走 deep，都落在「大模型」上（智能复盘）。
 */
import type { ModelTier } from '../types';
import { defaultTierConfigs } from './tier-config';

export interface ModelConfig {
  /** 快速任务用的小模型 */
  small: string;
  /** 复盘/教练类用的大模型 */
  big: string;
}

let current: ModelConfig = {
  small: defaultTierConfigs.fast.model,
  big: defaultTierConfigs.deep.model,
};

export const getModelConfig = (): ModelConfig => current;

export const setModelConfig = (patch: Partial<ModelConfig>): void => {
  current = { ...current, ...patch };
};

export const resolveModel = (tier: ModelTier): string =>
  tier === 'fast' ? current.small : current.big;
