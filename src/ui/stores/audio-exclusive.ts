/**
 * 音频互斥：同一时刻只允许一个音乐源在响。
 *
 * 各音源（环境音 / 音乐库 / 专注音乐 / 自定义天气歌 / 背景视频）注册自己的停止函数，
 * 播放时调用 silenceOthers(id) 停掉其余所有源。
 * 同时维护「当前活跃音源」：背景视频默认出声，一旦用户播放任何音乐（活跃源 ≠ 背景视频），
 * 视频自动静音；音乐全部停下（活跃源清空）后视频恢复声音。
 */
type Stopper = () => void;
const stoppers = new Map<string, Stopper>();

export const registerAudioStopper = (id: string, stopper: Stopper): void => {
  stoppers.set(id, stopper);
};

export const unregisterAudioStopper = (id: string): void => {
  stoppers.delete(id);
};

/** 当前活跃音源：null=无声，'background-video'=背景视频出声，其它=用户在放音乐 */
let activeSource: string | null = null;
let videoMutedValue = false;
const videoMuteListeners = new Set<(muted: boolean) => void>();

const isVideoSilenced = (): boolean =>
  activeSource !== null && activeSource !== 'background-video';

const emit = (): void => {
  videoMutedValue = isVideoSilenced();
  videoMuteListeners.forEach((listener) => listener(videoMutedValue));
};

export const getVideoMuted = (): boolean => videoMutedValue;

/** 主音量（0-1）：主页/全屏音量键写入，背景视频等订阅跟随 */
let masterVolume = 1;
const volumeListeners = new Set<(volume: number) => void>();

export const setMasterVolume = (volume: number): void => {
  masterVolume = Math.max(0, Math.min(1, volume));
  volumeListeners.forEach((listener) => listener(masterVolume));
};

export const getMasterVolume = (): number => masterVolume;

export const subscribeMasterVolume = (listener: (volume: number) => void): (() => void) => {
  volumeListeners.add(listener);
  listener(masterVolume);
  return () => {
    volumeListeners.delete(listener);
  };
};

/** 全局静音（音量键双击）：视频背景音同样受控 */
let masterMuted = false;
const muteListeners = new Set<(muted: boolean) => void>();

export const setMasterMuted = (muted: boolean): void => {
  masterMuted = muted;
  muteListeners.forEach((listener) => listener(masterMuted));
};

export const getMasterMuted = (): boolean => masterMuted;

export const subscribeMasterMuted = (listener: (muted: boolean) => void): (() => void) => {
  muteListeners.add(listener);
  listener(masterMuted);
  return () => {
    muteListeners.delete(listener);
  };
};

/** 声明某音源为当前活跃源（播放方调用） */
export const setActiveSource = (id: string): void => {
  activeSource = id;
  emit();
};

/** 当前活跃音源 id（null=无声）。背景音乐据此判断「用户在放别的音乐时别抢」 */
export const getActiveSource = (): string | null => activeSource;

/** 某音源停止/暂停后释放（仅当它确实是当前活跃源时清空） */
export const clearActiveSource = (id: string): void => {
  if (activeSource === id) {
    activeSource = null;
    emit();
  }
};

/** 订阅「背景视频是否应静音」（用户播音乐 → true） */
export const subscribeVideoMuted = (listener: (muted: boolean) => void): (() => void) => {
  videoMuteListeners.add(listener);
  listener(isVideoSilenced());
  return () => {
    videoMuteListeners.delete(listener);
  };
};

/** 让除 exceptId 之外的所有音源停止，并把 exceptId 记为当前活跃源（同一时刻只有一个在响） */
export const silenceOthers = (exceptId: string): void => {
  for (const [id, stop] of stoppers) {
    if (id === exceptId) continue;
    try {
      stop();
    } catch {
      // 停止失败不能拖垮播放主流程
    }
  }
  setActiveSource(exceptId);
};
