import { annaInvoke } from './bridge';

/** File contents are supplied only after the user selects a document in the browser. */
const pickFile = (accept: string): Promise<File | undefined> => new Promise((resolve) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', () => resolve(input.files?.[0]), { once: true });
  input.addEventListener('cancel', () => resolve(undefined), { once: true });
  input.click();
});

export const pickAnnaDocument = (): Promise<File | undefined> =>
  pickFile('.md,.markdown,.txt,.text,.pdf,.epub,.mobi,.azw3');

export const pickAnnaVideo = (): Promise<File | undefined> => pickFile('.mp4,.webm');

export const pickAnnaAudio = (): Promise<File | undefined> => pickFile('.mp3,.flac,.wav,.ogg,.m4a');

export interface FileTransferProgress {
  phase: 'transferring' | 'committing';
  bytes: number;
  total: number;
}

export interface FileTransferOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FileTransferProgress) => void;
}

const stageFile = async (file: File, kind: 'document' | 'audio' | 'background', options: FileTransferOptions): Promise<string> => {
  options.signal?.throwIfAborted();
  const maxMb = kind === 'background' ? 128 : 32;
  if (file.size > maxMb * 1024 * 1024) throw new Error(`单个导入文件上限为 ${maxMb} MB`);
  if (kind !== 'document' && file.size === 0) throw new Error(kind === 'background' ? '视频文件为空' : '音频文件为空');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const allowed = kind === 'background' ? ['mp4', 'webm'] : kind === 'audio' ? ['mp3', 'flac', 'wav', 'ogg', 'm4a'] : ['md', 'markdown', 'txt', 'text', 'pdf', 'epub', 'mobi', 'azw3'];
  if (!extension || !allowed.includes(extension)) {
    throw new Error('不支持的文件格式');
  }
  // Keep a readable filename without allowing path separators or Windows special names.
  const label = Array.from(file.name.replace(/\.[^.]+$/, '')).slice(0, 30)
    .map((character) => character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character).join('');
  const name = `${crypto.randomUUID()}_${label}.${extension}`;
  try {
    options.onProgress?.({ phase: 'transferring', bytes: 0, total: file.size });
    for (let offset = 0; offset < Math.max(file.size, 1); offset += 64 * 1024) {
      options.signal?.throwIfAborted();
      const bytes = new Uint8Array(await file.slice(offset, offset + 64 * 1024).arrayBuffer());
      options.signal?.throwIfAborted();
      // Wait for the current write before cleanup so late writes cannot recreate a partial file.
      await annaInvoke<string>('file_stage', { name, kind, offset, bytes: Array.from(bytes), complete: false });
      options.signal?.throwIfAborted();
      options.onProgress?.({ phase: 'transferring', bytes: offset + bytes.length, total: file.size });
    }
    options.signal?.throwIfAborted();
    options.onProgress?.({ phase: 'committing', bytes: file.size, total: file.size });
    // Once commit starts, report its actual outcome even if the caller subsequently aborts.
    return await annaInvoke<string>('file_stage_commit', { name, kind, size: file.size });
  } catch (error) {
    try {
      await annaInvoke('file_stage_abort', { name, kind });
    } catch {
      throw new Error('导入未完成，临时文件清理失败；重新启动后会清理超过 24 小时的临时文件。');
    }
    throw error;
  }
};

export const stageAnnaDocument = (file: File, options: FileTransferOptions = {}): Promise<string> => stageFile(file, 'document', options);
export const stageAnnaAudio = (file: File, options: FileTransferOptions = {}): Promise<string> => stageFile(file, 'audio', options);

export const stageAnnaVideo = (file: File, options: FileTransferOptions = {}): Promise<string> => stageFile(file, 'background', options);
