/**
 * 全屏心流小筑 Demo 共享类型（V4 §8 / §9 / §13 / §28）。
 *
 * 状态轴相互独立，不把所有组合写成巨大枚举。视觉资源通过语义键解析，
 * 组件里不写文件路径（Asset Resolver 负责映射）。
 */

export type SceneId = 'study-room' | 'library';
export type TimePhase = 'day' | 'dusk' | 'night';
export type WeatherType = 'clear' | 'rain' | 'snow' | 'spring' | 'summer';
export type TimeMode = 'auto' | TimePhase;
export type FocusVisualState = 'idle' | 'active' | 'paused' | 'elapsed';
export type PanelKey = 'today' | 'focus' | 'knowledge' | 'review' | 'companion' | 'letter' | 'settings';

/** 女孩语义动作（V4 §24） */
export type GirlAction =
  | 'idle'
  | 'writing'
  | 'stretch'
  | 'drink'
  | 'turn_page'
  | 'look_outside';

/** 宠物语义动作（V4 §25；学习语义动作按 Sprite Sheet 文档扩展） */
export type PetAction =
  | 'idle'
  | 'greet'
  | 'cheer'
  | 'concerned'
  | 'sleep_enter'
  | 'sleep_loop'
  | 'wake'
  | 'look_at_girl'
  // 学习语义动作（Sprite Sheet 支持；无 Sprite 时 CSS 降级）
  | 'study_loop'
  | 'needs_input'
  | 'ready'
  | 'move_left'
  | 'move_right'
  // 认真查看问题（陪伴提问/苏格拉底问句时的小动作）
  | 'examining';

/** 场景状态轴（V4 §8） */
export interface SceneState {
  sceneId: SceneId;
  timePhase: TimePhase;
  weather: WeatherType;
  focusState: FocusVisualState;
  sceneBrightness: number;
  reducedMotion: boolean;
}

/**
 * 单个环境的背景音乐模式：
 * none    无（该环境没有背景音乐）
 * builtin 内置（雨天雨声、雪天雪声、晴天晴日）
 * custom  用户自定义本地音频（循环播放，每个环境各自一首）
 */
export type AmbientMode = 'none' | 'builtin' | 'custom';

/** 单个环境的背景音乐配置；file 仅在 custom 模式下有意义 */
export interface AmbientSetting {
  mode: AmbientMode;
  /** 自定义本地音频文件路径（该环境自己的，不与其它环境共用） */
  file?: string;
}

/** 设置面板本地状态（V4 §43） */
export interface DemoSettings {
  sceneId: SceneId;
  /** auto 跟随本地时间，否则固定预览某个阶段 */
  timeMode: TimeMode;
  weather: WeatherType;
  brightness: number;
  envAnimation: boolean;
  reducedMotion: boolean;
  showPet: boolean;
  petAutoRest: boolean;
  petQuietInFocus: boolean;
  /** 按环境（晴/雨/雪）分别配置背景音乐，每个环境可以有自己的自定义音频 */
  ambientByWeather: Record<WeatherType, AmbientSetting>;
}

/** 归一化锚点：x/y 为 0-1（相对视口） */
export interface NormalizedPoint {
  x: number;
  y: number;
  scale?: number;
}

export interface SceneAnchors {
  girl: NormalizedPoint;
  pet: NormalizedPoint;
  focusHud: NormalizedPoint;
  dock: NormalizedPoint;
  speechBubble: NormalizedPoint;
}

export type AnimationRenderer = 'css' | 'video' | 'lottie' | 'rive' | 'sprite';

/** 动画描述对象（V4 §13），不再用裸字符串直接指向文件 */
export interface AnimationDescriptor {
  renderer: AnimationRenderer;
  src?: string;
  poster?: string;
  loop: boolean;
  durationMs?: number;
  playbackRate?: number;
  returnTo?: string;
  reducedMotionPoster?: string;
  // ---- sprite（Sprite Sheet 桌宠）专用 ----
  frameWidth?: number;
  frameHeight?: number;
  columns?: number;
  rows?: number;
  /** 展示缩放（1 = 原始帧尺寸；桌面宠物用 0.2 等缩小） */
  scale?: number;
  /** 该动画用到的格子序号（行优先），如 idle: [0..7] */
  frames?: number[];
  fps?: number;
  /** 逐帧时长（ms），优先于 fps */
  frameDurationsMs?: number[];
  /** 循环起点帧（默认 frames[0]） */
  loopStart?: number;
  /** 一次性动作结束后的回退动作 */
  fallback?: string;
  /** reduced-motion 下显示的静态帧 */
  reducedMotionFrame?: number;
}

/** 场景 Manifest（V4 §12，demo 用 TS 默认值，后续可换成 manifest.json） */
export interface SceneManifest {
  id: SceneId;
  name: string;
  backgrounds: Record<TimePhase, string> & { fallback: string };
  windowMask?: string;
  anchors: SceneAnchors;
}

/** 语义视觉指令（V4 §9 / §28），Agent 只允许输出这种形状 */
export interface VisualCue {
  id: string;
  actor: ActorId;
  action: string;
  priority: number;
  loop?: boolean;
  returnTo?: string;
  chain?: string[];
  payload?: Record<string, unknown>;
}

export type ActorId = 'pet' | 'girl' | 'ambient' | 'scene';

/** 未来 Agent 意图（V4 §29），未知 actor/action 一律拒绝回退 none */
export interface SceneAgentIntent {
  kind: 'visual_cue' | 'dialogue' | 'none';
  actor?: 'pet' | 'girl' | 'scene' | 'weather';
  action?:
    | 'sleep'
    | 'wake'
    | 'greet'
    | 'stretch'
    | 'switch_study_room'
    | 'switch_library'
    | 'set_clear'
    | 'set_rain'
    | 'set_snow';
  speech?: string;
}
