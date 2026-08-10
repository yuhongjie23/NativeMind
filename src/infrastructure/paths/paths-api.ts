/**
 * 路径与音乐 API（Tauri 命令封装）
 *
 * 独立于 runtime 装配：运行时探测 Tauri 与否，非 Tauri 环境（vite dev / vitest）
 * 返回空桩，保证 UI 仍可开发调试。真正的路径许可由 Rust 侧 enforce：
 * 这里只做两件事 —— 把设置里的目录同步给 Rust（file_update_paths），
 * 以及读音乐清单/字节（audio_list_music / audio_read）。
 */

export interface AppPathsInfo {
  dataDir: string;
  resourceDir: string;
  readDirs: string[];
  musicDir?: string;
}

/** 与 Rust 侧 MusicAsset（camelCase）对应 */
export interface MusicAsset {
  path: string;
  name: string;
  sizeBytes: number;
}

/** file_set_app_paths 的返回：改完后的路径（即时热替换，无需重启） */
export interface SetPathsResult {
  dataDir: string;
  resourceDir: string;
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
};

/**
 * 归一化展示路径：Windows 的 `\\?\` 扩展前缀在 UI 里就是「路径前面的乱码」，
 * 这里剥离掉（Rust 侧已统一处理，这里作为兜底）。
 */
const cleanPath = (value: string): string => {
  if (value.startsWith('\\\\?\\')) {
    return value.slice(4);
  }
  return value;
};

const cleanInfo = (info: AppPathsInfo): AppPathsInfo => ({
  dataDir: cleanPath(info.dataDir),
  resourceDir: cleanPath(info.resourceDir),
  readDirs: info.readDirs.map(cleanPath),
  musicDir: info.musicDir ? cleanPath(info.musicDir) : undefined,
});

/** 当前应用目录（设置页展示用） */
export const getAppPaths = async (): Promise<AppPathsInfo> => {
  if (!isTauri()) return { dataDir: '', resourceDir: '', readDirs: [] };
  return cleanInfo(await invoke<AppPathsInfo>('file_app_paths'));
};

/**
 * 修改存储地址 / 资源目录，**即时热替换**，无需重启。
 * dataDir 变化时 Rust 侧会迁移数据并直接切到新库；resourceDir 即时生效。
 * 传空字符串表示清除该覆盖（回默认），不传表示不修改。
 */
export const setAppPaths = async (
  patch: { dataDir?: string; resourceDir?: string },
  opts?: { migrate?: boolean }
): Promise<SetPathsResult> => {
  if (!isTauri()) {
    return {
      dataDir: cleanPath(patch.dataDir ?? ''),
      resourceDir: cleanPath(patch.resourceDir ?? ''),
    };
  }
  return invoke<SetPathsResult>('file_set_app_paths', {
    dataDir: patch.dataDir,
    resourceDir: patch.resourceDir,
    migrate: opts?.migrate,
  });
};

/** 把设置里的读取目录/音乐目录同步给 Rust，让 check_readable 放行 */
export const updateAppPaths = async (readDirs: string[], musicDir?: string): Promise<void> => {
  if (!isTauri()) return;
  await invoke('file_update_paths', { readDirs, musicDir });
};

/** 配置的读取目录里可导入的文档清单（知识页「快速导入」直接列出并导入） */
export interface ReadableDoc {
  path: string;
  name: string;
  sizeBytes: number;
  dir: string;
}
export const listReadableDocs = async (): Promise<ReadableDoc[]> => {
  if (!isTauri()) return [];
  try {
    return await invoke<ReadableDoc[]>('doc_list_readable');
  } catch {
    return [];
  }
};

/** 音乐目录下的音频清单 */
export const listMusic = async (): Promise<MusicAsset[]> =>
  isTauri() ? invoke<MusicAsset[]>('audio_list_music') : [];

/** 检查某个 Ollama 模型是否已安装（设置页模型可用性检查） */
export const checkModelAvailable = async (model: string): Promise<boolean> => {
  if (!isTauri() || !model.trim()) return false;
  return invoke<boolean>('model_is_available', { model });
};

/** 列出本机 Ollama 已安装的模型（设置页快速/教练模型下拉选项） */
export interface InstalledModelInfo {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
}
export const listInstalledModels = async (): Promise<InstalledModelInfo[]> => {
  if (!isTauri()) return [];
  try {
    return await invoke<InstalledModelInfo[]>('model_list');
  } catch {
    return [];
  }
};

/** Ollama 服务是否就绪（首启引导用） */
export const isModelReady = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  return invoke<boolean>('model_is_ready');
};

/**
 * 确保本机 Ollama 在运行：未运行则后台拉起 `ollama serve`。
 * 返回当前状态；非 Tauri 环境 / 命令不可用时返回 null（静默跳过）。
 */
export const ensureOllamaRunning = async (): Promise<'already_running' | 'started' | 'failed' | null> => {
  if (!isTauri()) return null;
  try {
    return await invoke<'already_running' | 'started' | 'failed'>('ollama_ensure_running');
  } catch {
    return null;
  }
};

/**
 * 读取一首音乐的字节。Rust 侧用 tauri::ipc::Response 返回原始字节，
 * invoke 拿到 ArrayBuffer，可直接喂给 Blob。
 */
export const readMusicBytes = async (path: string): Promise<ArrayBuffer> => {
  if (!isTauri()) return new ArrayBuffer(0);
  return invoke<ArrayBuffer>('audio_read', { path });
};

/** 读取随包背景音乐字节（resources/audio/backgrounds 内），前端转 Blob 播放 */
export const readBgmBytes = async (path: string): Promise<ArrayBuffer> => {
  if (!isTauri()) return new ArrayBuffer(0);
  return invoke<ArrayBuffer>('bgm_read', { path });
};

/**
 * 读取应用许可目录内的音频字节（自定义背景音乐用）。
 * 与 readMusicBytes 的区别：readMusicBytes 只允许音乐目录内的文件，
 * 而自定义背景音频经 file_import_into_data_dir 复制进数据目录，需走
 * audio_read_imported（check_readable 白名单）。
 */
export const readImportedBytes = async (path: string): Promise<ArrayBuffer> => {
  if (!isTauri()) return new ArrayBuffer(0);
  return invoke<ArrayBuffer>('audio_read_imported', { path });
};

/**
 * 在系统浏览器中打开外部链接（知识页外部搜索结果点进观看）。
 * Tauri 用 shell 插件，浏览器回退 window.open。
 */
export const openExternal = async (url: string): Promise<void> => {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch {
      // 插件不可用等：回退
    }
  }
  window.open(url, '_blank', 'noopener');
};
