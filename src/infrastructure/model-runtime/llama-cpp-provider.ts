/**
 * llama.cpp Provider（备选运行时）
 *
 * 走 llama-server 的 OpenAI 兼容接口。和 Ollama 的差别在于：
 * llama-server 一个进程只加载一个模型，所以 isAvailable 只认自己那一个 model 名，
 * 不做多模型探测 —— 跨模型降级在这种部署下本来就不成立。
 */
import {
  assertLocalUrl,
  fetchWithTimeout,
  type EmbeddingProvider,
  type InstalledModel,
  type ModelCompletionRequest,
  type ModelRuntime,
} from './model-interface';

export interface LlamaCppOptions {
  baseUrl?: string;
  /** 当前进程加载的模型名。留空表示「来什么都接」 */
  loadedModel?: string;
  timeoutMs?: number;
  embeddingVersion?: string;
  fetchImpl?: typeof fetch;
}

export class LlamaCppProvider implements ModelRuntime, EmbeddingProvider {
  readonly name = 'llama.cpp';
  readonly version: string;

  private readonly baseUrl: string;
  private readonly loadedModel?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LlamaCppOptions = {}) {
    this.baseUrl = assertLocalUrl(options.baseUrl ?? 'http://localhost:8080');
    this.loadedModel = options.loadedModel;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.version = options.embeddingVersion ?? `llama-cpp:${options.loadedModel ?? 'default'}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      this.timeoutMs
    );
    if (!response.ok) throw new Error(`llama.cpp ${path} 返回 ${response.status}`);
    return (await response.json()) as T;
  }

  async isReady(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/health`, {}, 3_000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<InstalledModel[]> {
    if (!(await this.isReady())) return [];
    return [{ name: this.loadedModel ?? 'llama-server' }];
  }

  /** 进程里就一个模型：名字对不上就直接说不可用，让路由降级 */
  async isAvailable(model: string): Promise<boolean> {
    if (!(await this.isReady())) return false;
    if (!this.loadedModel) return true;
    return model === this.loadedModel;
  }

  async complete(request: ModelCompletionRequest): Promise<string> {
    if (request.onToken) return this.streamComplete(request);

    const data = await this.post<{ choices?: { message?: { content?: string } }[] }>(
      '/v1/chat/completions',
      {
        model: request.model,
        messages: this.buildMessages(request),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens,
        // 与 Ollama 的 format=json 等价，逼模型输出合法 JSON（C5）
        response_format: request.json ? { type: 'json_object' } : undefined,
        stream: false,
      }
    );

    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * 流式生成（SSE）：/v1/chat/completions 带 stream:true 后按
   * `data: {...}\n\n` 返回，增量在 choices[0].delta.content；结束标记 `data: [DONE]`。
   * 返回体没有读流能力（测试桩等场景）时退化为一次性解析。
   */
  private async streamComplete(request: ModelCompletionRequest): Promise<string> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: this.buildMessages(request),
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens,
          response_format: request.json ? { type: 'json_object' } : undefined,
          stream: true,
        }),
      },
      this.timeoutMs
    );
    if (!response.ok) throw new Error(`llama.cpp /v1/chat/completions 返回 ${response.status}`);
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

  private buildMessages(request: ModelCompletionRequest): { role: string; content: string }[] {
    return [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.prompt },
    ];
  }

  /** llama-server 的 /v1/embeddings 支持数组入参，一次发完 */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const data = await this.post<{ data?: { embedding: number[]; index?: number }[] }>(
      '/v1/embeddings',
      { model: this.loadedModel, input: texts }
    );

    const items = data.data ?? [];
    // 返回顺序理论上与输入一致，但有 index 时按它排更稳
    return texts.map((_, position) => {
      const match = items.find((item) => item.index === position) ?? items[position];
      return match?.embedding ?? [];
    });
  }
}
