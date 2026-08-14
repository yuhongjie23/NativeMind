/**
 * 双模型配置单例
 *
 * 运行时在 settings 加载前就构建，所以模型名不能只读库。
 * 这里用模块级可变配置：settings-store 加载/变更时 `setModelConfig`，
 * ModelRouter 每次调用用 `resolveModel` 现取 —— 用户换模型无需重启。
 *
 * 映射：
 * - fast → 本地小模型（默认 1.5B），始终走本地 Ollama
 * - coach / deep → 默认本地大模型（14B）；配置 DeepSeek API key 后走云端
 *   （deepseek-chat / deepseek-reasoner，由档位选择）
 *
 * 未配 key 时 coach/deep 落回本地大模型（providerMode='local'），功能不中断。
 */
import type { ModelTier } from '../types';
import { defaultTierConfigs } from './tier-config';

export type ProviderMode = 'local' | 'deepseek';

export interface ModelConfig {
  /** 快速任务用的本地小模型 */
  small: string;
  /** 本地大模型（coach/deep 未配 DeepSeek 时的兜底） */
  big: string;
  /** 教练档用哪个 provider：本地 / DeepSeek 云端 */
  providerMode: ProviderMode;
  /** DeepSeek API key（用户配置；明文存本地 SQLite） */
  apiKey?: string;
  /** DeepSeek 档位：deepseek-v4-flash（快）/ deepseek-v4-pro（强） */
  deepseekModel: string;
  /** DeepSeek 思考模式：true 走 thinking（更强但更慢更贵） */
  deepseekThinking: boolean;
}

let current: ModelConfig = {
  small: defaultTierConfigs.fast.model,
  big: defaultTierConfigs.deep.model,
  providerMode: 'local',
  deepseekModel: 'deepseek-v4-flash',
  deepseekThinking: false,
};

export const getModelConfig = (): ModelConfig => current;

export const setModelConfig = (patch: Partial<ModelConfig>): void => {
  current = { ...current, ...patch };
};

/** 教练档请求 DeepSeek 时用的模型名（官方正式版，旧 chat/reasoner 名 2026-07-24 停用） */
export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;

export const resolveModel = (tier: ModelTier): string => {
  // fast 始终本地；coach/deep 未启用 DeepSeek 时也本地
  if (tier === 'fast' || current.providerMode !== 'deepseek') {
    return tier === 'fast' ? current.small : current.big;
  }
  return current.deepseekModel;
};
