/**
 * 请求/响应类型
 *
 * 本地优先的应用没有后端 HTTP API，UI 调的是 use-case。
 * 这里定义的是 UI 与用例之间的通用包装：异步资源的状态、Tauri IPC 命令的形状。
 */

/** 异步数据的三态。让页面能区分「还没开始加载」和「加载完是空的」 */
export type AsyncState = 'idle' | 'loading' | 'ready' | 'error';

export interface AsyncResource<T> {
  status: AsyncState;
  data: T;
  error?: string;
}

export const idleResource = <T>(initial: T): AsyncResource<T> => ({
  status: 'idle',
  data: initial,
});

/** 把用例的抛错收成 AsyncResource，避免每个 store 各写一遍 try/catch */
export const toErrorResource = <T>(current: AsyncResource<T>, error: unknown): AsyncResource<T> => ({
  status: 'error',
  data: current.data,
  error: error instanceof Error ? error.message : String(error),
});

/** Tauri IPC 命令名。SQL 走 Rust 侧执行（见 infrastructure/db/tauri-driver） */
export type IpcCommand = 'plugin:sql|select' | 'plugin:sql|execute';

export interface PaginationRequest {
  limit: number;
  offset: number;
}
