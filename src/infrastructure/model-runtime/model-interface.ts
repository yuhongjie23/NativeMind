/**
 * 本地模型运行时接口（C7）
 *
 * ai 层的 ModelProvider / EmbeddingProvider 是最小契约，
 * 这里补上运行时特有的能力：列出已安装模型、上报资源占用。
 * 前者给设置页选模型用，后者给 Job 调度判断「现在能不能跑 embedding」。
 */
import type { EmbeddingProvider, ModelCompletionRequest, ModelProvider } from '@ai/types';

export type { EmbeddingProvider, ModelCompletionRequest, ModelProvider };

export interface InstalledModel {
  name: string;
  /** 字节数。设置页展示「这个模型占多少磁盘」 */
  sizeBytes?: number;
  parameterSize?: string;
}

export interface ModelRuntime extends ModelProvider {
  readonly name: string;
  /** 运行时本体（Ollama 服务 / llama.cpp 进程）是否就绪 */
  isReady(): Promise<boolean>;
  listModels(): Promise<InstalledModel[]>;
}

/** 只允许连本机：模型推理不该悄悄走到远端服务（C6） */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export const assertLocalUrl = (url: string): string => {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`模型运行时只允许连本机，收到 ${host}`);
  }
  return url.replace(/\/+$/, '');
};

/**
 * 带超时的 fetch。
 * 本地大模型有时会卡住不返回，没有超时的话整个 UI 会一直转圈，
 * 超时后当作「模型不可用」走降级链更符合预期（§16.1）。
 */
export const fetchWithTimeout = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};
