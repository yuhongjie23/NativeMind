/**
 * 音频播放
 *
 * 环境音是「一次只能有一个」：切换白噪声时旧的必须停，否则会叠在一起。
 * 提示音可以并发，短音效重叠不影响体验。
 * 播放失败（文件缺失、自动播放被浏览器拦）一律静默处理 —— 声音是锦上添花，
 * 不该因为它抛错打断专注流程。
 */
import { AUDIO_LIBRARY, getTrack, type AudioTrack } from './audio-library';

export * from './audio-library';

/** 抽象成接口，测试里不需要真的 Audio 元素 */
export interface AudioHandle {
  play(): Promise<void>;
  pause(): void;
  set volume(value: number);
  set loop(value: boolean);
}

export type AudioFactory = (src: string) => AudioHandle;

const defaultFactory: AudioFactory = (src) => {
  const element = new Audio(src);
  return {
    play: () => element.play(),
    pause: () => element.pause(),
    set volume(value: number) {
      element.volume = value;
    },
    set loop(value: boolean) {
      element.loop = value;
    },
  };
};

export class AudioPlayer {
  private readonly factory: AudioFactory;
  /** 已创建的实例，避免重复播放同一音效时反复 new */
  private readonly handles = new Map<string, AudioHandle>();
  private currentAmbient: string | null = null;
  private masterVolume = 1;
  private muted = false;

  constructor(factory: AudioFactory = defaultFactory) {
    this.factory = factory;
  }

  private handleFor(track: AudioTrack): AudioHandle {
    const existing = this.handles.get(track.id);
    if (existing) return existing;
    const handle = this.factory(track.src);
    this.handles.set(track.id, handle);
    return handle;
  }

  setMasterVolume(value: number): void {
    this.masterVolume = Math.min(1, Math.max(0, value));
    // 音量滑块要即时作用于正在播放的环境音，不能等下次 play
    this.syncAmbientVolume();
  }

  /** 真静音：音量归零而不是停掉播放，恢复时接着响，不会断 */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncAmbientVolume();
  }

  /** 把当前环境音的音量同步成「默认音量 × 主音量 × (静音?0:1)」 */
  private syncAmbientVolume(): void {
    if (!this.currentAmbient) return;
    const track = getTrack(this.currentAmbient);
    const handle = this.handles.get(this.currentAmbient);
    if (track && handle) {
      handle.volume = this.muted ? 0 : track.defaultVolume * this.masterVolume;
    }
  }

  async play(trackId: string): Promise<void> {
    const track = getTrack(trackId);
    if (!track) return;

    // 提示音（cue/companion）静音时不响；环境音静音时按 0 音量继续（取消静音可恢复）
    if (this.muted && track.category !== 'ambient') return;

    // 环境音互斥
    if (track.category === 'ambient' && this.currentAmbient && this.currentAmbient !== trackId) {
      this.stopAmbient();
    }

    const handle = this.handleFor(track);
    // 静音时也把 currentAmbient 记上（静音播放），这样取消静音能接着响
    handle.volume = this.muted ? 0 : track.defaultVolume * this.masterVolume;
    handle.loop = track.loop;

    try {
      await handle.play();
      if (track.category === 'ambient') this.currentAmbient = trackId;
    } catch {
      // 自动播放策略或文件缺失，忽略
    }
  }

  stopAmbient(): void {
    if (!this.currentAmbient) return;
    this.handles.get(this.currentAmbient)?.pause();
    this.currentAmbient = null;
  }

  stopAll(): void {
    this.handles.forEach((handle) => handle.pause());
    this.currentAmbient = null;
  }

  get playingAmbient(): string | null {
    return this.currentAmbient;
  }

  /** 提前把音效加载好，避免专注结束时提示音延迟半秒才响 */
  preload(trackIds: string[] = Object.keys(AUDIO_LIBRARY)): void {
    trackIds.forEach((id) => {
      const track = getTrack(id);
      if (track) this.handleFor(track);
    });
  }
}
