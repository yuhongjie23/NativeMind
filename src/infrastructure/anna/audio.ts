import { annaInvoke } from './bridge';

interface AudioChunk { bytes: number[]; size: number }

/** Bounded frames keep binary audio out of a single oversized JSON-RPC response. */
export const readAnnaAudio = async (path: string): Promise<ArrayBuffer> => {
  let result: Uint8Array<ArrayBuffer> | undefined;
  let offset = 0;
  do {
    const chunk = await annaInvoke<AudioChunk>('audio_read_chunk', { path, offset });
    if (!Number.isSafeInteger(chunk.size) || chunk.size <= 0 || chunk.size > 32 * 1024 * 1024
      || !Array.isArray(chunk.bytes) || chunk.bytes.length === 0 || chunk.bytes.length > 128 * 1024
      || chunk.bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('Anna 音频数据无效');
    }
    result ??= new Uint8Array(chunk.size);
    if (result.length !== chunk.size || offset + chunk.bytes.length > result.length) {
      throw new Error('音频文件在读取期间发生变化');
    }
    result.set(chunk.bytes, offset);
    offset += chunk.bytes.length;
  } while (offset < result.length);
  return result.buffer;
};
