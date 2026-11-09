import { isModelJob, runModelJob, type ModelCallOptions } from './model-jobs';
import { isFileJob, runFileJob } from './file-jobs';
import type { TauriInvoke } from '../db/tauri-driver';
import { assertLocalAnnaEnvironment } from './local-policy';

export { createAnnaInvoke } from './connection';
export type { AnnaHost } from './connection';

/** Only the dedicated Anna entry installs this bridge, before importing the App. */
let nativeInvoke: TauriInvoke | undefined;

export const isAnna = (): boolean => nativeInvoke !== undefined;

export const installAnnaBridge = (invoke: TauriInvoke): void => {
  assertLocalAnnaEnvironment();
  if (nativeInvoke) throw new Error('Anna bridge already installed');
  nativeInvoke = invoke;
};

export const annaInvoke = <T>(command: string, args?: Record<string, unknown>, options?: ModelCallOptions): Promise<T> => {
  if (!nativeInvoke) return Promise.reject(new Error('Anna 尚未连接，不能退回演示数据'));
  if (isFileJob(command)) return runFileJob<T>(nativeInvoke, command, args, options?.signal);
  return isModelJob(command) ? runModelJob<T>(nativeInvoke, command, args, options) : nativeInvoke<T>(command, args);
};
