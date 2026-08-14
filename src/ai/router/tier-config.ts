/**
 * 模型层级配置与任务路由表（§8.1 / §8.2）
 *
 * 这张表是「新增 AI 任务」的唯一入口：加一行即可，业务代码不动（§17.3）。
 * 模型名按 Ollama 命名，换模型只改这里。
 */
import type { ModelTier, PromptId, SchemaId, TaskType } from '../types';

export interface TierConfig {
  model: string;
  /** 上下文窗口，供调用方裁剪输入 */
  contextTokens: number;
  maxTokens: number;
  temperature: number;
  /** 内存占用目标（§16），仅作文档与设置页提示用 */
  memoryBudgetMb: number;
}

// 注意：模型名不是 tier-config 决策的。resolveModel（model-config.ts）只分两档——
// fast → 设置里 small，coach/deep → 设置里 big。这里三个 model 字段仅是**默认种子值**
// （设置首次加载前用），coach 与 deep 共用 big，改它不会影响运行时实际用的模型。
export const defaultTierConfigs: Record<ModelTier, TierConfig> = {
  fast: { model: 'qwen2.5:1.5b', contextTokens: 8192, maxTokens: 1024, temperature: 0.2, memoryBudgetMb: 2048 },
  coach: { model: 'qwen2.5:14b', contextTokens: 16384, maxTokens: 2048, temperature: 0.5, memoryBudgetMb: 6144 },
  deep: { model: 'qwen2.5:14b', contextTokens: 32768, maxTokens: 4096, temperature: 0.5, memoryBudgetMb: 12288 },
};

export interface TaskRoute {
  tier: ModelTier;
  promptVersion?: PromptId;
  /** 有 schema 就必须过校验（C5） */
  schemaId?: SchemaId;
  requiresJson: boolean;
}

export const TASK_ROUTES: Record<TaskType, TaskRoute> = {
  // 快速执行层：格式稳定优先，低创造性
  intent: { tier: 'fast', promptVersion: 'intent.v1', schemaId: 'intent.v1', requiresJson: true },
  tag_generation: { tier: 'fast', schemaId: 'link-hyde.v1', requiresJson: true },
  light_summary: { tier: 'fast', requiresJson: false },
  search_keywords: { tier: 'fast', requiresJson: true },
  search_result_filter: { tier: 'fast', requiresJson: true },
  companion_dialogue: { tier: 'fast', requiresJson: false },

  // 学习教练层：需要理解与判断，是主脑
  todo_structuring: {
    // P1：todo 拆解升到 coach 档（big 模型）。fast 档 1.5B 对 prompt 里的
    // 「保持用户粒度 / 禁止编造」这类约束遵循力差，会照抄示例编造章节；
    // 14B 才能稳定遵循反编造规则。代价是拆解变慢，但这是用户主动触发的低频操作。
    tier: 'coach',
    promptVersion: 'todo-structuring.v1',
    schemaId: 'todo.v1',
    requiresJson: true,
  },
  todo_breakdown: { tier: 'coach', promptVersion: 'todo-structuring.v1', requiresJson: false },
  socratic_question: { tier: 'coach', promptVersion: 'socratic.v1', requiresJson: false },
  rag_relation: {
    tier: 'coach',
    promptVersion: 'rag-relation.v1',
    schemaId: 'knowledge-link.v1',
    requiresJson: true,
  },
  review_daily: {
    tier: 'coach',
    promptVersion: 'review-daily.v1',
    schemaId: 'review-log.v1',
    requiresJson: true,
  },
  search_result_ranking: { tier: 'coach', requiresJson: true },

  // 高质量增强层：慢且贵，不进默认主流程
  review_weekly: {
    tier: 'deep',
    promptVersion: 'review-weekly.v1',
    schemaId: 'review-log.v1',
    requiresJson: true,
  },
  review_monthly: {
    tier: 'deep',
    promptVersion: 'review-monthly.v1',
    schemaId: 'review-log.v1',
    requiresJson: true,
  },
  // 检索查询改写：纯文本输出（无 schema），深度检索用
  query_rewrite: {
    tier: 'fast',
    promptVersion: 'query-rewrite.v1',
    requiresJson: false,
  },
  long_document_analysis: { tier: 'deep', requiresJson: false },
  // 深度问答（Self-RAG）：生成走 coach 主脑自由文本；评判走 JSON 结构化（qa-critic.v1）
  deep_qa_generate: { tier: 'coach', requiresJson: false },
  deep_qa_critic: { tier: 'coach', schemaId: 'qa-critic.v1', requiresJson: true },
  // Flora 写信：情感分析(快) + 高级模型回信(深) + 低级模型验证(快)
  letter_emotion: { tier: 'fast', schemaId: 'letter-emotion.v1', requiresJson: true },
  letter_reply: { tier: 'deep', requiresJson: false },
  letter_verify: { tier: 'fast', schemaId: 'letter-verify.v1', requiresJson: true },
};

/**
 * 降级链（§16.1）。
 * fast 失败往上升级换取更强的格式遵循能力（§8.5）；coach / deep 失败往下退，
 * 保证「模型不可用时产品不崩溃」，最终由调用方转入用户手动模式。
 */
export const TIER_FALLBACK: Record<ModelTier, ModelTier | null> = {
  fast: 'coach',
  coach: 'fast',
  deep: 'coach',
};
