import { annaInvoke, isAnna } from './anna';

export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
interface VideoChunk { bytes: number[]; size: number }

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (isAnna()) return annaInvoke<T>(command, args);
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(command, args);
}

export async function chooseDesktopVideo(): Promise<string | undefined> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, filters: [{ name: 'Video', extensions: ['mp4', 'webm'] }] });
  return typeof path === 'string' ? invoke<string>('video_import', { path }) : undefined;
}

/** Bounded local chunks; aborting a scene change prevents reading the remaining file. */
export async function readBackgroundVideo(path: string, signal: AbortSignal): Promise<Blob> {
  const parts: BlobPart[] = [];
  let offset = 0;
  let size: number | undefined;
  do {
    signal.throwIfAborted();
    const chunk = await invoke<VideoChunk>('video_read_chunk', { path, offset });
    signal.throwIfAborted();
    if (!Number.isSafeInteger(chunk.size) || chunk.size <= 0 || chunk.size > MAX_VIDEO_BYTES
      || !Array.isArray(chunk.bytes) || !chunk.bytes.length || chunk.bytes.length > 128 * 1024
      || chunk.bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('背景视频数据无效');
    }
    size ??= chunk.size;
    if (size !== chunk.size || offset + chunk.bytes.length > size) throw new Error('视频在读取期间发生变化');
    parts.push(new Uint8Array(chunk.bytes));
    offset += chunk.bytes.length;
  } while (offset < size);
  return new Blob(parts, { type: path.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4' });
}
