/**
 * 走 Rust 的模型运行时（C7）
 *
 * 与 OllamaProvider 的分工：两者实现同一套接口，区别只在 HTTP 由谁发。
 * 生产环境优先用这个，原因是 WebView 的网络行为不由我们控制 ——
 * 不同平台的 WKWebView / WebView2 对 localhost 请求有各自的拦截和
 * CORS 策略，同一份 fetch 代码在 Windows 能通、在 macOS 打包后失败
 * 是这类应用的常见坑。挪到 Rust 侧用系统网络栈就没有这层不确定性。
 *
 * 与 tauri-driver 同理，invoke 通过构造参数注入：vitest 里没有 Tauri
 * 运行时，顶层 import @tauri-apps/api 会直接把测试炸掉。
 */
import type { EmbeddingProvider, InstalledModel, ModelCompletionRequest, ModelRuntime } from './model-interface';

/** 与 Rust 侧约定的命令签名 */
export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriModelProviderOptions {
  /** embedding 模型名。与 tier-config 的 embedding 配置保持一致 */
  embeddingModel?: string;
  /**
   * embedding 版本号，写入 note.embedding_version。
   * 换模型必须同时改这个值，否则新旧向量混在同一个空间里，检索结果会毫无意义。
   */
  embeddingVersion?: string;
  /** 本地 7B 生成一段复盘可能要几十秒，默认给足 */
  timeoutMs?: number;
}

const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

export class TauriModelProvider implements ModelRuntime, EmbeddingProvider {
  readonly name = 'tauri-ollama';
  readonly version: string;

  private readonly embeddingModel: string;
  private readonly timeoutMs?: number;

  constructor(
    private readonly invoke: TauriInvoke,
    options: TauriModelProviderOptions = {}
  ) {
    this.embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.version = options.embeddingVersion ?? `${this.embeddingModel}@tauri`;
    this.timeoutMs = options.timeoutMs;
  }

  /**
   * 这三个探测方法一律不抛错。
   * ModelRouter 的降级链（§16.1）靠布尔值判断某一层能不能用，
   * 抛错会打断整条链，把「模型没装」这种正常情况变成崩溃。
   * Rust 侧命令签名已经是 Result<_, ()>，这里再兜一层是防 IPC 本身失败
   * （比如命令未注册），那种情况同样应该走降级而不是崩。
   */
  async isReady(): Promise<boolean> {
    try {
      return await this.invoke<boolean>('model_is_ready');
    } catch {
      return false;
    }
  }

  async listModels(): Promise<InstalledModel[]> {
    try {
      return await this.invoke<InstalledModel[]>('model_list');
    } catch {
      return [];
    }
  }

  async isAvailable(model: string): Promise<boolean> {
    try {
      return await this.invoke<boolean>('model_is_available', { model });
    } catch {
      return false;
    }
  }

  /**
   * 文本生成。这个方法**会**抛错，与上面三个探测方法不同：
   * 走到这里说明已经判定模型可用，此时失败是真异常，
   * ModelRouter 需要拿到错误才能决定重试还是降级。
   *
   * 参数用 snake_case：Rust 的 CompletionRequest 没有 rename_all，
   * serde 按字段原名反序列化，写成 maxTokens 会静默丢失。
   * 带 onToken 时走流式命令：增量经 Channel 实时回调，最终仍返回全文。
   */
  async complete(request: ModelCompletionRequest): Promise<string> {
    if (request.onToken) return this.invokeStream(request);
    return this.invoke<string>('model_complete', {
      request: this.toPayload(request),
    });
  }

  private toPayload(request: ModelCompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      prompt: request.prompt,
      system: request.system,
      json: request.json ?? false,
      // 目标结构，交给 Ollama 做约束解码。Rust 侧字段名同为 json_schema
      json_schema: request.jsonSchema,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      timeout_ms: this.timeoutMs,
    };
  }

  private async invokeStream(request: ModelCompletionRequest): Promise<string> {
    // 延迟 import：vitest 环境没有 Tauri 运行时，顶层 import 会把测试炸掉
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<{ delta?: string; done?: boolean }>();
    let full = '';
    channel.onmessage = (event) => {
      if (event.delta) {
        full += event.delta;
        request.onToken?.(event.delta);
      }
    };

    const returned = await this.invoke<string>('model_complete_stream', {
      request: this.toPayload(request),
      on_token: channel,
    });
    // Channel 增量只是渐进预览，最终以命令返回的全文为准
    return typeof returned === 'string' && returned.length > 0 ? returned : full;
  }

  /** 批量向量化。空输入直接返回，省一次无意义的 IPC */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.invoke<number[][]>('model_embed', {
      model: this.embeddingModel,
      texts,
    });
  }
}
