/**
 * DeepSeek Provider（云端模型，用户配置 API key 启用）
 *
 * 走 DeepSeek 官方 OpenAI 兼容接口（https://api.deepseek.com/v1/chat/completions）。
 * 用于教练档（coach / deep）：任务拆解、复盘、知识关联、陪伴等需要理解与判断的任务。
 *
 * 与本地 Provider 的差别：
 * - 数据出本机：笔记内容会发送到 DeepSeek 服务器，设置页必须明示（用户配 key = 知情同意）
 * - 没有 embedding：向量检索永远走本地（DeepSeek 不提供 embedding API）
 * - isAvailable = key 已配置；isReady = 真实打一次 /models 验证 key 有效
 * - listModels 返回固定档位：deepseek-chat（快）/ deepseek-reasoner（深度思考）
 *
 * 安全：baseUrl 固定官方地址，不接受任意 URL（避免把 key 发给第三方）。
 */
import {
  fetchWithTimeout,
  type EmbeddingProvider,
  type InstalledModel,
  type ModelCompletionRequest,
  type ModelRuntime,
} from './model-interface';

/** DeepSeek 官方 API 地址（固定，不接受配置——防止 key 泄漏到第三方） */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export interface DeepSeekOptions {
  /** 用户 API key（设置页配置，明文存本地 SQLite） */
  apiKey?: string;
  /** 默认档位模型，留空用 deepseek-v4-flash */
  model?: string;
  /** 思考模式：true 走 thinking（更强但更慢更贵） */
  thinking?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class DeepSeekProvider implements ModelRuntime {
  readonly name = 'deepseek';
  /** DeepSeek 无 embedding，占位避免类型错配；实际 embedding 由本地 provider 承担 */
  readonly embedding: EmbeddingProvider | null = null;

  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private key: string | undefined;
  private model: string;
  private thinking: boolean;

  constructor(options: DeepSeekOptions = {}) {
    this.key = options.apiKey;
    this.model = options.model ?? 'deepseek-v4-flash';
    this.thinking = options.thinking ?? false;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** 设置页配置新 key / 档位 / 思考模式后热切换（无需重启） */
  configure(patch: { apiKey?: string; model?: string; thinking?: boolean }): void {
    if (patch.apiKey !== undefined) this.key = patch.apiKey;
    if (patch.model !== undefined) this.model = patch.model;
    if (patch.thinking !== undefined) this.thinking = patch.thinking;
  }

  getApiKey(): string | undefined {
    return this.key;
  }

  /** key 未配置 = 不可用（ModelRouter 据此降级到本地） */
  async isAvailable(_model: string): Promise<boolean> {
    return Boolean(this.key?.trim());
  }

  /** 真实打一次 /models 验证 key 有效（设置页「测试」用） */
  async isReady(): Promise<boolean> {
    if (!this.key?.trim()) return false;
    try {
      const response = await fetchWithTimeout(
        this.fetchImpl,
        `${DEEPSEEK_BASE_URL}/v1/models`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.key.trim()}`,
          },
        },
        10_000
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<InstalledModel[]> {
    return [
      { name: 'deepseek-v4-flash', parameterSize: 'V4-Flash' },
      { name: 'deepseek-v4-pro', parameterSize: 'V4-Pro' },
    ];
  }

  /** 档位选择：只认官方正式名，未知名回退默认 */
  private resolveModelName(requested: string): string {
    if (requested.includes('v4-pro')) return 'deepseek-v4-pro';
    if (requested.includes('v4-flash')) return 'deepseek-v4-flash';
    return this.model;
  }

  /** OpenAI 兼容的 thinking 参数：reasoning_effort 或 extra body 开关 */
  private thinkingParam(): Record<string, unknown> {
    return this.thinking ? { thinking: { type: 'enabled' } } : {};
  }

  async complete(request: ModelCompletionRequest): Promise<string> {
    if (request.onToken) return this.streamComplete(request);

    const data = await this.post<{ choices?: { message?: { content?: string } }[] }>(
      '/v1/chat/completions',
      {
        model: this.resolveModelName(request.model),
        messages: this.buildMessages(request),
        temperature: request.temperature ?? 0.5,
        max_tokens: request.maxTokens,
        // OpenAI 兼容的 JSON 模式；不保证结构，靠事后 Schema 校验兜底（C5）
        response_format: request.json ? { type: 'json_object' } : undefined,
        ...this.thinkingParam(),
        stream: false,
      }
    );
    return data.choices?.[0]?.message?.content ?? '';
  }

  /** 流式生成（SSE），与本地 provider 同语义 */
  private async streamComplete(request: ModelCompletionRequest): Promise<string> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${DEEPSEEK_BASE_URL}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.key?.trim() ?? ''}`,
        },
        body: JSON.stringify({
          model: this.resolveModelName(request.model),
          messages: this.buildMessages(request),
          temperature: request.temperature ?? 0.5,
          max_tokens: request.maxTokens,
          response_format: request.json ? { type: 'json_object' } : undefined,
          ...this.thinkingParam(),
          stream: true,
        }),
      },
      this.timeoutMs
    );
    if (!response.ok) throw new Error(`DeepSeek /v1/chat/completions 返回 ${response.status}`);
    if (!response.body) {
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    const onToken = request.onToken!;
    try {
      const feed = (chunk: string): void => {
        const payload = chunk.trim().replace(/^data:\s*/i, '');
        if (!payload || payload === '[DONE]' || payload.startsWith(':')) return;
        try {
          const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            onToken(delta);
          }
        } catch {
          // 容忍半行 / 非 JSON 噪音
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) feed(event);
      }
      if (buffer.trim()) feed(buffer);
    } finally {
      reader.releaseLock();
    }
    return full;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.key?.trim()) throw new Error('DeepSeek API key 未配置');
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${DEEPSEEK_BASE_URL}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.key.trim()}`,
        },
        body: JSON.stringify(body),
      },
      this.timeoutMs
    );
    if (!response.ok) throw new Error(`DeepSeek ${path} 返回 ${response.status}`);
    return (await response.json()) as T;
  }

  private buildMessages(request: ModelCompletionRequest): { role: string; content: string }[] {
    return [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.prompt },
    ];
  }
}
