import { annaInvoke, isAnna } from './anna';

export interface StorageCheck { path: string; writable: boolean; reason?: string }
export const supportsStartupCheck = (): boolean => isAnna() || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
export async function checkStorage(): Promise<StorageCheck> {
  if (!supportsStartupCheck()) throw new Error('网页演示不保存本地数据');
  if (isAnna()) return annaInvoke<StorageCheck>('storage_check');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<StorageCheck>('storage_check');
}

/** Only copy a single safe model argument, never executable user-supplied shell text. */
export function modelDownloadCommand(name: string): string | undefined {
  const model = name.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model) ? `ollama pull ${model}` : undefined;
}
