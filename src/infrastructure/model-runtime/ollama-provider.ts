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
    this.version = options.embeddingVersion ?? `ollama:${this.embeddingModel}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      this.timeoutMs
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
   * 因为 tier-config 里写 `qwen2.5:7b` 而 Ollama 可能报 `qwen2.5:7b-instruct-q4_0`。
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
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens,
      },
    });
    return data.response ?? '';
  }

  /**
   * 流式生成（NDJSON）：/api/generate 带 stream:true 后按行返回
   * `{"response":"增量","done":false}`，逐条交给 onToken；最终拼全文返回。
   * 返回体没有读流能力（测试桩等场景）时退化为一次性解析。
   */
  private async streamComplete(request: ModelCompletionRequest): Promise<string> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          system: request.system,
          format: request.json ? (request.jsonSchema ?? 'json') : undefined,
          stream: true,
          options: {
            temperature: request.temperature ?? 0.2,
            num_predict: request.maxTokens,
          },
        }),
      },
      this.timeoutMs
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
    const onToken = request.onToken!;
    try {
      const feed = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const chunk = JSON.parse(trimmed) as { response?: string };
          if (chunk.response) {
            full += chunk.response;
            onToken(chunk.response);
          }
        } catch {
          // 容忍半行 / 非 JSON 噪音
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) feed(line);
      }
      if (buffer.trim()) feed(buffer);
    } finally {
      reader.releaseLock();
    }
    return full;
  }

  /**
   * 批量 embedding。Ollama 的 /api/embeddings 一次只接一段文本，
   * 这里串行发送 —— 并发会把本地显存打满，反而更慢。
   */
  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const text of texts) {
      const data = await this.post<{ embedding?: number[] }>('/api/embeddings', {
        model: this.embeddingModel,
        prompt: text,
      });
      vectors.push(data.embedding ?? []);
    }
    return vectors;
  }

  /** 用户装了新模型后调用，让下次 isAvailable 重新探测 */
  invalidateModelCache(): void {
    this.installed = null;
  }
}
