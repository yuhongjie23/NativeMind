/**
 * ModelRouter - 所有模型调用的唯一入口（§8.2）
 *
 * 业务代码不直接调模型，这样换模型、加模型、A/B 测试、记日志、统一降级都只动这里。
 *
 * 调用链（§8.5 + §16.1）：
 *   选层级 → 检查可用性 → 调模型 → 解析 JSON → Schema 校验
 *     → 校验失败：同层重试 1 次
 *     → 仍失败或模型不可用：降级到 TIER_FALLBACK 的下一层
 *     → 仍失败：返回 ok=false，由调用方转「用户手动填写」，绝不抛错中断产品
 */
import { renderPrompt, type PromptVars } from '../prompts';
import { getSchema, toDecodingSchema } from '../schemas';

import { extractJson, hashInput, nowIso } from '../shared/utils';
import type {
  AIFailure,
  AIRequest,
  AIResult,
  ModelProvider,
  ModelRunRecorder,
  ModelTier,
  PromptId,
  SchemaId,
} from '../types';
import { validateAgainstSchema } from '../evaluation/json-validator';
import { TASK_ROUTES, TIER_FALLBACK, defaultTierConfigs, type TierConfig } from './tier-config';
import { resolveModel } from './model-config';

/** 每层最多尝试次数（首次 + 重试一次），对应 §16.1「重试一次」 */
const MAX_ATTEMPTS_PER_TIER = 2;

export interface RouterOptions {
  tierConfigs?: Partial<Record<ModelTier, TierConfig>>;
  /** 模型调用日志，缺省则不记录 */
  recorder?: ModelRunRecorder;
}

/**
 * 按 tier 选 provider：支持「快档走本地、教练档走云端」的混合部署。
 * 返回 null 表示该 tier 无可用 provider（ModelRouter 降级到 TIER_FALLBACK）。
 */
export type ProviderSelector = (tier: ModelTier) => ModelProvider | null;

/** 供各能力模块使用的请求扩展：带上 prompt 变量，router 负责渲染 */
export interface RoutedRequest<I = unknown> extends AIRequest<I> {
  promptVars?: PromptVars;
  /** 覆盖路由表的 prompt，用于同一任务的多套模板实验 */
  promptOverride?: PromptId;
  /** 无 prompt 模板的任务（如标签生成）可直接给出完整提示词 */
  inlinePrompt?: { system?: string; user: string };
}

export class ModelRouter {
  private readonly tiers: Record<ModelTier, TierConfig>;
  private readonly recorder?: ModelRunRecorder;

  constructor(
    /** 默认 provider；同时支持按 tier 精确路由（ProviderSelector 优先） */
    private readonly provider: ModelProvider,
    options: RouterOptions = {},
    private readonly providerFor?: ProviderSelector
  ) {
    this.tiers = { ...defaultTierConfigs, ...options.tierConfigs } as Record<ModelTier, TierConfig>;
    this.recorder = options.recorder;
  }

  /** 当前 tier 实际用的 provider（精确路由优先，回退默认） */
  private providerOf(tier: ModelTier): ModelProvider | null {
    return this.providerFor ? this.providerFor(tier) ?? this.provider : this.provider;
  }

  /** 供设置页展示「当前功能需要本地模型」提示（§16.1） */
  async isTierAvailable(tier: ModelTier): Promise<boolean> {
    const selected = this.providerOf(tier);
    if (!selected) return false;
    return selected.isAvailable(resolveModel(tier));
  }

  async run<I, O>(request: RoutedRequest<I>): Promise<AIResult<O>> {
    const route = TASK_ROUTES[request.taskType];
    const startTier = request.modelPolicy?.preferredTier ?? route.tier;
    const promptId = request.promptOverride ?? route.promptVersion;
    const schemaId = route.schemaId;
    const requiresJson = request.modelPolicy?.requiresJson ?? route.requiresJson;

    let tier: ModelTier | null = startTier;
    let attempts = 0;
    let lastError: AIFailure = { kind: 'model_error', message: '未执行任何调用' };
    const visited = new Set<ModelTier>();

    while (tier && !visited.has(tier)) {
      visited.add(tier);
      const config = this.tiers[tier];
      const model = resolveModel(tier);
      const selected = this.providerOf(tier);

      // 该 tier 没有可用 provider（如云端未配 key）→ 直接降级
      if (!selected) {
        lastError = { kind: 'model_unavailable', message: `该档位无可用模型: ${model}` };
        if (request.modelPolicy?.noFallback) break;
        tier = TIER_FALLBACK[tier];
        continue;
      }

      if (!(await selected.isAvailable(model))) {
        lastError = { kind: 'model_unavailable', message: `模型不可用: ${model}` };
        // noFallback：一次失败直接结束，不升级（宠物气泡等延迟敏感场景）
        if (request.modelPolicy?.noFallback) break;
        tier = TIER_FALLBACK[tier];
        continue;
      }

      // noRetry：同层只试一次（宠物一句气泡不值得重试拖延迟）
      const attemptsPerTier = request.modelPolicy?.noRetry ? 1 : MAX_ATTEMPTS_PER_TIER;
      for (let i = 0; i < attemptsPerTier; i += 1) {
        attempts += 1;
        const outcome = await this.attempt<O>(request, {
          tier,
          config,
          promptId,
          schemaId,
          requiresJson,
          provider: selected,
          // 重试时把上一轮的错误回灌给模型，比原样再问一次更可能修好格式
          retryHint: i > 0 ? lastError.message : undefined,
        });

        if (outcome.ok) {
          const result: AIResult<O> = {
            ...outcome.result,
            attempts,
            degraded: tier !== startTier,
          };
          await this.log(request, result, schemaId ? 'passed' : 'skipped');
          return result;
        }

        lastError = outcome.error;
        // 模型本身挂了，同层重试没意义，直接降级
        if (outcome.error.kind === 'model_error') break;
      }

      if (request.modelPolicy?.noFallback) break;
      tier = TIER_FALLBACK[tier];
    }

    const failed: AIResult<O> = {
      ok: false,
      tier: startTier,
      model: resolveModel(startTier),
      promptVersion: promptId,
      schemaId,
      attempts,
      degraded: visited.size > 1,
      error: lastError,
    };
    await this.log(request, failed, schemaId ? 'failed' : 'skipped');
    return failed;
  }

  /** 单次调用：渲染 → 请求 → 解析 → 校验 */
  private async attempt<O>(
    request: RoutedRequest,
    ctx: {
      tier: ModelTier;
      config: TierConfig;
      promptId?: PromptId;
      schemaId?: SchemaId;
      requiresJson: boolean;
      provider: ModelProvider;
      retryHint?: string;
    }
  ): Promise<{ ok: true; result: AIResult<O> } | { ok: false; error: AIFailure }> {
    const { tier, config, promptId, schemaId, requiresJson, provider, retryHint } = ctx;

    const base = promptId
      ? renderPrompt(promptId, request.promptVars)
      : { system: request.inlinePrompt?.system ?? '', user: request.inlinePrompt?.user ?? '' };

    if (!base.user) {
      return { ok: false, error: { kind: 'model_error', message: '缺少 prompt 内容' } };
    }

    const user = retryHint
      ? `${base.user}\n\n上一次输出不符合要求（${retryHint}），请严格按格式重新输出。`
      : base.user;

    let raw: string;
    try {
      raw = await provider.complete({
        model: resolveModel(tier),
        system: base.system || undefined,
        prompt: user,
        json: requiresJson,
        // 把目标结构交给运行时做约束解码。只靠 prompt 要求「输出数组」，
        // 本地小模型会稳定返回单个对象，每次都栽在下面的 schema 校验上。
        // 用 toDecodingSchema 而非原始 Schema：大 maxLength 会让 Ollama 编译
        // GBNF 失败并整个请求 400。校验时仍用原始 Schema，约束没有被放松。
        jsonSchema: requiresJson && schemaId ? toDecodingSchema(getSchema(schemaId)) : undefined,
        onToken: request.onToken,

        temperature: request.modelPolicy?.temperature ?? config.temperature,
        maxTokens: request.modelPolicy?.maxTokens ?? config.maxTokens,
      });

    } catch (error) {
      return {
        ok: false,
        error: { kind: 'model_error', message: error instanceof Error ? error.message : String(error) },
      };
    }

    const meta = { tier, model: resolveModel(tier), promptVersion: promptId, schemaId };

    // 自由文本任务（复盘草稿之外的教练类输出）直接返回原文
    if (!requiresJson) {
      return {
        ok: true,
        result: { ok: true, output: raw.trim() as unknown as O, raw, attempts: 1, degraded: false, ...meta },
      };
    }

    const jsonText = extractJson(raw);
    if (!jsonText) {
      return { ok: false, error: { kind: 'invalid_json', message: '输出中找不到 JSON' } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      return {
        ok: false,
        error: { kind: 'invalid_json', message: error instanceof Error ? error.message : 'JSON 解析失败' },
      };
    }

    // 无 schema 的 JSON 任务不做结构校验，由调用方自己收敛
    if (!schemaId) {
      return {
        ok: true,
        result: { ok: true, output: parsed as O, raw, attempts: 1, degraded: false, ...meta },
      };
    }

    const validated = validateAgainstSchema<O>(parsed, getSchema(schemaId));
    if (!validated.ok) {
      return { ok: false, error: { kind: 'schema_invalid', message: validated.errors.join('; ') } };
    }

    return {
      ok: true,
      result: { ok: true, output: validated.value, raw, attempts: 1, degraded: false, ...meta },
    };
  }

  private async log(
    request: RoutedRequest,
    result: AIResult,
    validationResult: 'passed' | 'failed' | 'skipped'
  ): Promise<void> {
    if (!this.recorder) return;

    // 日志属于系统运行型写入（§12.1），失败不能影响主流程
    try {
      await this.recorder.record({
        taskType: request.taskType,
        tier: result.tier,
        model: result.model,
        promptVersion: result.promptVersion,
        schemaId: result.schemaId,
        inputHash: hashInput(request.input),
        output: result.raw,
        validationResult,
        attempts: result.attempts,
        degraded: result.degraded,
        createdAt: nowIso(),
      });
    } catch (error) {
      console.warn('[ModelRouter] 写入 model_runs 失败:', error);
    }
  }
}
