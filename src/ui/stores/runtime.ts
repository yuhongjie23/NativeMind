/**
 * 运行时单例
 *
 * 所有 store 共用一个 Application 实例。构建时把 UI 的确认弹窗接进去，
 * 这样 AI 建议型写入自然会走到 ConfirmationModal，不需要每个 store 各自处理。
 *
 * 环境二选一：
 * - Tauri 里 → SQLite 仓储 + 真实本地模型（生产路径）
 * - 纯浏览器（vite dev / vitest）→ 内存仓储 + 模板 AI，保证 UI 仍可开发调试
 *
 * 检测靠 window.__TAURI_INTERNALS__ 而不是 try/catch import：
 * @tauri-apps/api 在浏览器里能正常 import，只是 invoke 调用时才失败，
 * 靠导入是否成功来判断环境会得到错误结论。
 */
import { createLocalDemoRuntime } from '@infrastructure/local-demo';
import { createTauriRuntime } from '@infrastructure/tauri-runtime';
import { uiConfirmationPrompt, uiConfirmPrompt } from './confirmation-store';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 生产路径下 Rust 侧执行 SQL，这里只发命令 */
const tauriInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
};

const createRuntime = () => {
  if (!isTauri()) {
    console.info('[runtime] 非 Tauri 环境，使用内存演示运行时（数据不会持久化）');
    return {
      ...createLocalDemoRuntime({
        confirmationPrompt: uiConfirmationPrompt,
        confirmPrompt: uiConfirmPrompt,
      }),
      start: async () => () => undefined,
    };
  }

  return createTauriRuntime({
    invoke: (command, args) => tauriInvoke(command, args),
    confirmationPrompt: uiConfirmationPrompt,
    confirmPrompt: uiConfirmPrompt,
  });
};

export const runtime = createRuntime();

export const useCases = runtime.application.useCases;
export const policies = runtime.application.policies;
export const eventBus = runtime.application.eventBus;
export const repositories = runtime.repositories;
export const infrastructure = runtime.infrastructure;
export const audioPlayer = runtime.infrastructure.audioPlayer;
export const ai = runtime.ai;
export const deepseek = runtime.deepseek;

/**
 * 'template' = 规则拆分 + 模板填空，没有模型参与
 * 'model'    = 走本地模型（Ollama）
 *
 * UI 必须据此明确告知用户，否则模板输出看起来就像「AI 没用」。
 */
export const aiMode = runtime.aiMode;


/**
 * 建表 + 恢复中断任务 + 起后台轮询。由 App 在挂载时调用一次。
 *
 * 迁移没跑完就查表会撞 "no such table"，所以 UI 必须等这个 Promise
 * 落定后才能读数据。返回值用于卸载时停掉轮询。
 */
export const startRuntime = (): Promise<() => void> => runtime.start();

/** 用例抛错时给用户一句可读的话 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
