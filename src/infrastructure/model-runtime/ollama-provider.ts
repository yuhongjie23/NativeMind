/**
 * Ollama Provider（默认运行时）
 *
 * 同时实现 ModelProvider（生成）与 EmbeddingProvider（向量化）。
 * 关键点：isAvailable 不抛错，只返回真假 —— ModelRouter 的降级链依赖它判断
 * 「这一层能不能用」，抛错会打断整条链（§16.1）。
 */
import {
  assertLocalUrl,
  fetchWithTimeout,
  type EmbeddingProvider,
  type InstalledModel,
  type ModelCompletionRequest,
  type ModelRuntime,
} from './model-interface';
import { embeddingInput, embeddingVersion, type EmbeddingPurpose } from './embedding-input';

export interface OllamaOptions {
  baseUrl?: string;
  /** 生成超时。本地 7B 出一段复盘可能要几十秒，默认给足 */
  timeoutMs?: number;
  embeddingModel?: string;
  /** 与 embeddingModel 绑定的版本号，换模型要一起改，否则旧索引会被误判为有效 */
  embeddingVersion?: string;
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements ModelRuntime, EmbeddingProvider {
  readonly name = 'ollama';
  readonly version: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly embeddingModel: string;
  private readonly fetchImpl: typeof fetch;
  /** 已安装模型名缓存，避免每次路由都打一次 /api/tags */
  private installed: Set<string> | null = null;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = assertLocalUrl(options.baseUrl ?? 'http://localhost:11434');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.embeddingModel = options.embeddingModel ?? 'nomic-embed-text';
    this.version = embeddingVersion(this.embeddingModel, options.embeddingVersion ?? `ollama:${this.embeddingModel}`);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async withDeadline<T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Ollama 请求超时', 'TimeoutError')), this.timeoutMs);
    try {
      const result = await action(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(
      `${this.baseUrl}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
    );
    if (!response.ok) throw new Error(`Ollama ${path} 返回 ${response.status}`);
    return (await response.json()) as T;
  }

  async isReady(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/api/tags`, {}, 3_000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<InstalledModel[]> {
    try {
      const response = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/api/tags`, {}, 5_000);
      if (!response.ok) return [];
      const data = (await response.json()) as {
        models?: { name: string; size?: number; details?: { parameter_size?: string } }[];
      };
      return (data.models ?? []).map((model) => ({
        name: model.name,
        sizeBytes: model.size,
        parameterSize: model.details?.parameter_size,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 模型是否可用。比对时忽略 `:latest` 后缀，
   * 因为 tier-config 里写 `qwen3:4b` 而 Ollama 可能报 `qwen3:4b-instruct-q4_0`。
   */
  async isAvailable(model: string): Promise<boolean> {
    if (!this.installed) {
      const models = await this.listModels();
      if (models.length === 0) return false;
      this.installed = new Set(models.map((item) => item.name));
    }

    const target = model.replace(/:latest$/, '');
    return Array.from(this.installed).some(
      (name) => name === model || name.replace(/:latest$/, '') === target || name.startsWith(`${target}-`)
    );
  }

  async complete(request: ModelCompletionRequest): Promise<string> {
    return this.withDeadline(request.signal, signal => this.completeRequest({ ...request, signal }));
  }

  private async completeRequest(request: ModelCompletionRequest & { signal: AbortSignal }): Promise<string> {
    if (request.onToken) return this.streamComplete(request);

    const data = await this.post<{ response?: string }>('/api/generate', {
      model: request.model,
      prompt: request.prompt,
      system: request.system,
      // format 传 schema 是约束解码：Ollama 会在采样阶段就排除不符合结构的 token，
      // 比只说 'json'（仅保证是合法 JSON、不保证结构）可靠得多。
      // 没给 schema 时退回 'json'，保持原行为（C5）。
      format: request.json ? (request.jsonSchema ?? 'json') : undefined,

      stream: false,
      // Qwen3 的默认思考会耗尽短任务额度，必须用 API 参数关闭。
      think: /^(qwen3)(:|$)/.test(request.model) ? false : undefined,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens,
      },
    }, request.signal);
    return data.response ?? '';
  }

  /**
   * 流式生成（NDJSON）：/api/generate 带 stream:true 后按行返回
   * `{"response":"增量","done":false}`，逐条交给 onToken；最终拼全文返回。
   * 返回体没有读流能力（测试桩等场景）时退化为一次性解析。
   */
  private async streamComplete(request: ModelCompletionRequest): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/generate`,
      {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          system: request.system,
          format: request.json ? (request.jsonSchema ?? 'json') : undefined,
          stream: true,
          think: /^(qwen3)(:|$)/.test(request.model) ? false : undefined,
          options: {
            temperature: request.temperature ?? 0.2,
            num_predict: request.maxTokens,
          },
        }),
      }
    );
    if (!response.ok) throw new Error(`Ollama /api/generate 返回 ${response.status}`);
    if (!response.body) {
      const data = (await response.json()) as { response?: string };
      return data.response ?? '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let completed = false;
    const onToken = request.onToken!;
    try {
      const feed = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        request.signal?.throwIfAborted();
        const chunk = JSON.parse(trimmed) as { response?: string; error?: string; done?: boolean };
        if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
        if (chunk.response) {
          full += chunk.response;
          onToken(chunk.response);
        }
        completed = chunk.done === true;
      };

      for (;;) {
        const { done, value } = await reader.read();
        request.signal?.throwIfAborted();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) { feed(line); if (completed) break; }
        if (completed) break;
      }
      if (!completed && buffer.trim()) feed(buffer);
      if (!completed) throw new Error('Ollama 输出中断，请重试');
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return full;
  }

  /**
   * 批量 embedding。Ollama 的 /api/embeddings 一次只接一段文本，
   * 这里串行发送 —— 并发会把本地显存打满，反而更慢。
   */
  async embed(texts: string[], signal?: AbortSignal, purpose: EmbeddingPurpose = 'document'): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const [index, text] of texts.entries()) {
      signal?.throwIfAborted();
      const data = await this.withDeadline(signal, activeSignal => this.post<{ embedding?: number[] }>('/api/embeddings', {
        model: this.embeddingModel,
        prompt: embeddingInput(this.embeddingModel, text, purpose),
        // Leave GPU room for answer generation; bulk indexing stays warm.
        ...(purpose === 'query' && index === texts.length - 1 ? { keep_alive: 0 } : {}),
      }, activeSignal));
      vectors.push(data.embedding ?? []);
    }
    return vectors;
  }

  /** 用户装了新模型后调用，让下次 isAvailable 重新探测 */
  invalidateModelCache(): void {
    this.installed = null;
  }
}
