/**
 * AI 编排层公共契约
 *
 * 硬约束（对应架构 §2）：
 * - C1：本层只产出草稿（Draft）或建议，永不写库。落库由 application 层在用户确认后触发。
 * - C5：结构化输出必须过 Schema 校验才交给业务。
 * - C7：模型 / embedding / 向量库都是 Provider 接口，由 infrastructure 实现并在 bootstrap 注入。
 * - C9：枚举值固定，模型只能从既有集合里选，不得发明。
 *
 * 扩展点：新增 AI 任务 = 在 TaskType 加一项 + 在 router/tier-config 的 TASK_ROUTES 加一行
 *        + 补 prompt / schema 文件。业务代码不直接调模型（§17.3）。
 */
import type { ISO8601DateTime } from '@shared-types/common';

/* ---------- 模型分层（§8.1） ---------- */

/** fast = 1.5B/1.7B，coach = 7B/8B 主脑，deep = 14B 可选增强 */
export type ModelTier = 'fast' | 'coach' | 'deep';

/** 任务类型。新增任务在此追加，并同步 TASK_ROUTES。 */
export type TaskType =
  // 快速执行层
  | 'intent'
  | 'todo_structuring'
  | 'tag_generation'
  | 'light_summary'
  | 'search_keywords'
  | 'search_result_filter'
  | 'companion_dialogue'
  // 学习教练层
  | 'todo_breakdown'
  | 'socratic_question'
  | 'rag_relation'
  | 'review_daily'
  | 'search_result_ranking'
  // 高质量增强层
  | 'review_weekly'
  | 'review_monthly'
  | 'long_document_analysis'
  // 检索查询改写（Multi-Query / HyDE 的模型版）
  | 'query_rewrite'
  // 深度问答（Self-RAG）：生成回答 + 自我评判
  | 'deep_qa_generate'
  | 'deep_qa_critic'
  // Flora 写信：情感分析 + 高级模型回信 + 低级模型验证
  | 'letter_emotion'
  | 'letter_reply'
  | 'letter_verify';

/* ---------- 版本化标识（§17.2） ---------- */

export type PromptId =
  | 'intent.v1'
  | 'todo-structuring.v1'
  | 'review-daily.v1'
  | 'review-weekly.v1'
  | 'review-monthly.v1'
  | 'rag-relation.v1'
  | 'socratic.v1'
  | 'query-rewrite.v1';

export type SchemaId =
  | 'intent.v1'
  | 'todo.v1'
  | 'review-log.v1'
  | 'knowledge-link.v1'
  | 'link-hyde.v1'
  | 'qa-critic.v1'
  | 'letter-emotion.v1'
  | 'letter-verify.v1';

/* ---------- 标准化请求（§8.4） ---------- */

export interface ModelPolicy {
  /** 覆盖路由表默认层级，例如用户主动选「深度分析」 */
  preferredTier?: ModelTier;
  /** 是否允许联网。AI 层不做隐私裁决，只透传 application 的结论（C6） */
  allowExternal?: boolean;
  requiresJson?: boolean;
  temperature?: number;
  maxTokens?: number;
  /**
   * 单次调用策略（宠物气泡等对延迟敏感的场景）：
   * noRetry=true 同层不重试，noFallback=true 失败不升级到更高档模型——
   * 一次调用失败立即返回，由调用方用模板兜底，绝不让 14B 接管一句气泡。
   */
  noRetry?: boolean;
  noFallback?: boolean;
}

export interface AIRequest<I = unknown, C = unknown> {
  taskType: TaskType;
  input: I;
  context?: C;
  modelPolicy?: ModelPolicy;
  /** 流式预览回调，透传给 provider.complete 的 onToken（可选）；reset=true 表示新一轮生成、清空旧预览 */
  onToken?: (delta: string, reset?: boolean) => void;
}

export type AIFailureKind =
  | 'model_unavailable'
  | 'model_error'
  | 'invalid_json'
  | 'schema_invalid';

export interface AIFailure {
  kind: AIFailureKind;
  message: string;
}

export interface AIResult<O = unknown> {
  ok: boolean;
  /** 校验通过的草稿。ok 为 false 时不存在，调用方应降级为「用户手动填写」（§16.1） */
  output?: O;
  tier: ModelTier;
  model: string;
  promptVersion?: PromptId;
  schemaId?: SchemaId;
  attempts: number;
  /** 是否落到了降级层级，用于观测与「打扰率 / 合法率」统计 */
  degraded: boolean;
  raw?: string;
  error?: AIFailure;
}

/** 校验结果。ok 为 false 时 errors 至少一条，便于重试提示与日志定位 */
export type ValidationOutcome<O> = { ok: true; value: O } | { ok: false; errors: string[] };

/* ---------- Provider 端口（§17.1，由 infrastructure 实现） ---------- */

export interface ModelCompletionRequest {
  model: string;
  prompt: string;
  system?: string;

  /** 要求模型输出 JSON（Ollama 的 format=json 之类） */
  json?: boolean;
  /**
   * 流式回调：每次拿到一个文本增量时触发（用于 UI 逐字展示）。
   * 提供方若不支持流式则忽略，调用方拿 complete() 的完整结果兜底。
   * 约定：onToken 只是预览，最终以返回值（完整文本）为准。
   * reset=true：新一轮生成开始（如重生成精修稿），调用方应先清空旧预览再继续累积。
   */
  onToken?: (delta: string, reset?: boolean) => void;
  /**
   * 目标结构的 JSON Schema，交给运行时做**约束解码**（Ollama 的 format=<schema>）。
   *
   * 为什么需要它：光靠 prompt 说「只输出 JSON 数组」，本地小模型仍会返回单个对象
   * —— 实测 1.5B 和 7B 都稳定输出 `{...}` 而不是 `[{...}]`，于是每次都栽在
   * schema 校验上，用户侧表现为「点了没反应」。把 schema 交给运行时后，
   * 采样阶段就排除了非法 token，两个模型都能稳定给出数组。
   *
   * 只是提示：运行时不支持就忽略，仍会走事后 Schema 校验，不会漏过非法结构。
   */
  jsonSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
}


export interface ModelProvider {
  /** 模型未安装 / 显存不足时返回 false，不抛错（§16.1） */
  isAvailable(model: string): Promise<boolean>;
  complete(request: ModelCompletionRequest): Promise<string>;
}

export interface EmbeddingProvider {
  /** embedding 版本号，写入 note.embedding_version，升级时触发 RebuildIndexJob（§13.4） */
  readonly version: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorMatch {
  chunkId: string;
  noteId: string;
  text: string;
  /** 归一化到 0-1，越大越相似 */
  score: number;
  /** 段落在原笔记正文中的字符起始偏移（UI 定位用） */
  charStart?: number;
}

export interface VectorStorePort {
  query(embedding: number[], limit: number): Promise<VectorMatch[]>;
}

/**
 * 专用重排（cross-encoder）端口。与启发式 / 生成式重排的分工：
 * cross-encoder 对 query 与每段 doc 直接打分，精度最高、无需 prompt，
 * 由本地 rerank 模型服务（如 llama-server 跑 bge-reranker）实现。
 * 失败时调用方回退生成式 ReRanker（C3，绝不阻塞检索）。
 */
export interface RerankProvider {
  /** 对每个 doc 按与 query 的相关性打分，0-1 越大越相关，返回顺序与 docs 对齐 */
  rerank(query: string, docs: string[]): Promise<number[]>;
}

/* ---------- 模型调用日志（§8.4，第二阶段微调数据来源） ---------- */

export interface ModelRunLog {
  taskType: TaskType;
  tier: ModelTier;
  model: string;
  promptVersion?: PromptId;
  schemaId?: SchemaId;
  inputHash: string;
  output?: string;
  validationResult: 'passed' | 'failed' | 'skipped';
  attempts: number;
  degraded: boolean;
  /** 用户修正后的最终版本，由 application 层在确认时回填 */
  userCorrection?: string;
  createdAt: ISO8601DateTime;
}

export interface ModelRunRecorder {
  record(log: ModelRunLog): Promise<void>;
}
