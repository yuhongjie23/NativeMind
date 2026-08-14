# NativeMind「心流小筑」全屏场景与 AI 动画资产完整提示词 V4

> 适用范围：NativeMind 桌面端 Tauri 应用，1280 × 720 及以上电脑窗口。
>
> 目标：把当前“非全屏场景模块”改造成全屏沉浸式学习空间，并支持 AI 生成的 PNG、WebP、透明视频、天气动画、角色动画和多场景资源包。
>
> 当前仍是视觉 Demo，不接真实数据库、模型、音频和 Tauri 命令；但视觉资源接口必须能在后续与 Agent 和真实业务事件兼容。

---

## 提示词正文开始

你是 NativeMind 项目的资深桌面产品设计师、场景视觉设计师、动效设计师和 React + TypeScript 工程师。

请重新设计并实现 NativeMind 的“心流小筑”全屏桌面 Demo。当前实现把学习房间放在一个非全屏模块或大卡片里；本次必须把场景升级为覆盖整个应用窗口的沉浸式背景，所有时钟、Dock、音乐、场景控制和副面板都重新适配全屏场景。

用户后续可以用 AI 或专业动画软件生成：

- 房间背景图。
- 图书馆背景图。
- 白天、黄昏、夜晚背景变体。
- 下雨、下雪、云层、窗户水滴等环境动画。
- 小女孩写作业、翻书、喝水、伸懒腰等动画。
- 小宠物待机、打招呼、开心、趴下、睡觉、醒来等动画。
- 自定义 Dock 图标、场景图标和音乐封面。

本次实现既要能直接展示，也必须把所有美术内容设计成可替换资源插槽。不要把动画文件路径写进 Agent，不要让业务状态依赖具体 PNG、WebM、Lottie 或 Rive 文件。

## 1. 最终体验目标

应用打开后，用户看到的不是“一个应用里放着一张房间卡片”，而是“应用本身就是一间学习空间”。

第一视觉层：

- 全屏房间或图书馆背景。
- 正在学习的小女孩。
- 窗外天空、天气与环境光。

第二视觉层：

- 右侧番茄钟。
- 当前任务。
- 小宠物。

第三视觉层：

- 顶部状态栏。
- 底部 Dock。
- 右下角 lo-fi 音乐条。

点击 Dock 后才出现今天、专注、知识、复盘、陪伴和设置副面板。副面板关闭后，用户立即回到完整场景。

页面气质：

```text
安静
温柔
沉浸
简洁
成人可用的可爱
日系绘本感
lo-fi 学习陪伴
低打扰效率工具
```

不要做成营销页面、后台 Dashboard、儿童游戏、手游大厅、直播间或纯视频播放器。

## 2. 当前任务边界

本次是桌面端视觉 Demo。

允许：

- React 本地 state。
- 本地时间。
- 本地纯视觉倒计时。
- 本地场景、天气、角色动作切换。
- AI 生成后放入项目的本地 PNG、WebP、WebM、MP4、Lottie 或 Rive 资产。
- 没有正式素材时使用 CSS fallback。
- Lucide 图标作为当前默认图标。

禁止：

- 调用真实 Zustand 业务 store。
- 调用数据库。
- 调用 Tauri `invoke`。
- 调用 Rust command。
- 调用真实 Ollama、OpenAI 或 Agent。
- 修改 `src-tauri`。
- 修改数据库 migration。
- 修改现有 Tauri 命令名称和参数。
- 删除真实应用 `src/ui/App.tsx`。
- 把 Demo 假数据写入真实仓储。
- 从远程 URL 热链图片或视频。

所有 Demo 状态刷新后都可以恢复默认值。

## 3. 必须阅读的当前代码

开始前完整阅读：

```text
package.json
src/main.tsx
src/ui/App.tsx
src/ui/styles/globals.css
src/ui/demo/CozyHomeDemo.tsx
src/ui/demo/cozy-home-demo.css

src/types/events.ts
src/application/ports.ts
src/ai/companion/companion-agent.ts
src/ai/companion/interaction-generator.ts
src/application/events/subscribers/companion-subscriber.ts
src/application/policies/interaction-policy.ts
src/infrastructure/companion/companion-pack.ts
src/ui/stores/companion-store.ts
src/ui/components/features/CompanionWidget.tsx

.claude/skills/nativemind-cozy-ui/SKILL.md
.claude/skills/nativemind-pomodoro-flow-ui/SKILL.md
.claude/skills/nativemind-companion-widget/SKILL.md
.claude/skills/nativemind-ambient-scene/SKILL.md
.claude/skills/nativemind-tauri-ui-contract/SKILL.md
```

确认真实应用入口和 Demo 入口的关系。不要因为制作 Demo 而破坏真实页面。

## 4. 全屏页面架构

必须改为以下结构：

```text
FullscreenCozyHome
├── SceneViewport                         全屏场景画布
│   ├── BackgroundLayer                   房间/图书馆基础背景
│   ├── TimeLightingLayer                 白天/黄昏/夜晚光线
│   ├── WeatherBackLayer                  窗外雨雪、云、远景
│   ├── GirlActorLayer                    小女孩独立动画通道
│   ├── FurnitureForegroundLayer          桌面、书、灯等前景
│   ├── PetActorLayer                     宠物独立动画通道
│   ├── WeatherGlassLayer                 玻璃水滴、近景雪花
│   └── SceneVignetteLayer                极轻可读性压暗层
├── TopHud                                品牌、日期、场景和天气
├── FocusHud                              右侧番茄钟和当前任务
├── FeatureDock                           底部功能入口
├── LofiHud                               右下音乐条
├── SpeechBubbleLayer                     宠物气泡
└── DemoSheetLayer                        六个底部副面板
```

场景图层覆盖完整窗口。HUD 叠加在场景上方，而不是占用独立网格列。

## 5. 根布局

以 1440 × 900 为主设计尺寸：

```css
.fullscreen-cozy-home {
  position: relative;
  width: 100vw;
  height: 100dvh;
  min-width: 1180px;
  min-height: 680px;
  overflow: hidden;
  isolation: isolate;
  background: #29332f;
}

.scene-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
```

支持尺寸：

```text
1920 × 1080
1600 × 900
1440 × 900
1366 × 768
1280 × 720
```

不设计手机端。

全屏背景资源默认使用 16:9 画布，通过 `object-fit: cover` 填满。不同窗口比例下允许裁切边缘，但不能裁掉：

- 女孩头部和手部。
- 宠物。
- 窗户主要区域。
- 右侧 Focus HUD 后方的可读安全区。
- 底部 Dock 后方的安全区。

背景资产需预留：

- 左右各 8% 可裁切区。
- 顶部 6% 可裁切区。
- 底部 10% 可被 Dock 遮挡区。

## 6. 全屏坐标和锚点

不要用大量随意 `left: 57%` 的散落 CSS。使用归一化场景锚点：

```ts
interface NormalizedPoint {
  x: number; // 0 到 1
  y: number; // 0 到 1
}

interface SceneAnchors {
  girl: NormalizedPoint;
  pet: NormalizedPoint;
  focusHud: NormalizedPoint;
  lofiHud: NormalizedPoint;
  speechBubble: NormalizedPoint;
}
```

每个场景在 Manifest 中定义自己的锚点。例如：

```json
{
  "anchors": {
    "girl": { "x": 0.48, "y": 0.79 },
    "pet": { "x": 0.66, "y": 0.82 },
    "focusHud": { "x": 0.86, "y": 0.43 },
    "speechBubble": { "x": 0.69, "y": 0.67 }
  }
}
```

切换房间和图书馆时，由场景 Manifest 改变锚点，不在 React 组件里写 `if scene === ...` 的大量位置分支。

## 7. 图层顺序

固定 z-index 语义：

```text
0    背景底色
1    场景基础背景
2    时间光照覆盖层
3    窗外天气后层
4    女孩角色
5    桌面和近景家具
6    宠物角色
7    玻璃水滴和少量近景天气
8    可读性压暗层
20   顶部 HUD
22   Focus HUD
24   Dock
25   音乐条
28   气泡
40   副面板遮罩
50   副面板
60   tooltip
```

天气后层必须位于窗框或窗户遮罩之后，不能让雨雪落到室内人物头上。

玻璃层只能表现贴在窗玻璃上的水滴、雾气或反光，不能覆盖整个 UI。

## 8. 场景状态模型

使用相互独立的状态轴，不要把所有组合写成一个巨大枚举：

```ts
type SceneId = 'study-room' | 'library';
type TimePhase = 'day' | 'dusk' | 'night';
type WeatherType = 'clear' | 'rain' | 'snow';
type FocusVisualState = 'idle' | 'active' | 'paused' | 'elapsed';

interface SceneState {
  sceneId: SceneId;
  timePhase: TimePhase;
  weather: WeatherType;
  focusState: FocusVisualState;
  sceneBrightness: number;
  reducedMotion: boolean;
}
```

这样可以组合：

```text
白天 + 房间 + 晴天
黄昏 + 房间 + 下雨
夜晚 + 图书馆 + 下雪
白天 + 图书馆 + 下雨
```

不要为每一种组合写一个 React 页面。

## 9. Scene Director

增加一个纯前端 Demo 场景导演，负责协调各个视觉通道：

```ts
type ActorId = 'pet' | 'girl' | 'ambient' | 'scene';

interface VisualCue {
  id: string;
  actor: ActorId;
  action: string;
  priority: number;
  loop?: boolean;
  returnTo?: string;
  payload?: Record<string, unknown>;
}
```

Scene Director 只操作语义动作：

```text
scene.switch.library
weather.set.rain
pet.sleep
pet.wake
pet.cheer
girl.write
girl.stretch
girl.drink
ambient.dim
```

Scene Director 不能知道 `sleep-loop.webm` 的文件路径。资源解析交给 Asset Resolver。

本次 Demo 使用组件局部 state 或独立 Demo context，不接真实 Zustand store。

## 10. 资源包目录

建议建立：

```text
public/visual-packs/cozy-home/
├── manifest.json
├── scenes/
│   ├── study-room/
│   │   ├── scene.json
│   │   ├── backgrounds/
│   │   │   ├── day.webp
│   │   │   ├── dusk.webp
│   │   │   ├── night.webp
│   │   │   └── fallback.webp
│   │   ├── masks/
│   │   │   └── window-mask.png
│   │   └── foregrounds/
│   │       ├── desk.webp
│   │       └── props.webp
│   └── library/
│       ├── scene.json
│       ├── backgrounds/
│       │   ├── day.webp
│       │   ├── dusk.webp
│       │   ├── night.webp
│       │   └── fallback.webp
│       ├── masks/
│       │   └── window-mask.png
│       └── foregrounds/
│           ├── table.webp
│           └── shelves-front.webp
├── actors/
│   └── girl/
│       ├── actor.json
│       ├── posters/
│       │   ├── writing.webp
│       │   └── stretch.webp
│       └── animations/
│           ├── writing-loop.webm
│           ├── stretch.webm
│           ├── drink.webm
│           └── turn-page.webm
├── companions/
│   └── green-blob/
│       ├── actor.json
│       ├── posters/
│       │   ├── idle.webp
│       │   └── sleep.webp
│       └── animations/
│           ├── idle-loop.webm
│           ├── greet.webm
│           ├── cheer.webm
│           ├── sleep-enter.webm
│           ├── sleep-loop.webm
│           └── wake.webm
├── weather/
│   ├── rain/
│   │   ├── rain-back.webm
│   │   ├── rain-glass.webm
│   │   └── rain-poster.webp
│   └── snow/
│       ├── snow-back.webm
│       ├── snow-near.webm
│       └── snow-poster.webp
├── icons/
│   └── README.md
└── audio/
    └── README.md
```

没有某个文件时必须回退到 CSS 或 poster，不能让整个页面报错。

## 11. 总 Manifest

```json
{
  "schemaVersion": 1,
  "id": "cozy-home",
  "name": "心流小筑",
  "defaultScene": "study-room",
  "defaultWeather": "clear",
  "scenes": {
    "study-room": "scenes/study-room/scene.json",
    "library": "scenes/library/scene.json"
  },
  "actors": {
    "girl": "actors/girl/actor.json",
    "pet": "companions/green-blob/actor.json"
  },
  "weather": {
    "rain": "weather/rain",
    "snow": "weather/snow"
  }
}
```

所有路径相对于 Manifest。不要保存绝对磁盘路径。

## 12. 场景 Manifest

示例：

```json
{
  "schemaVersion": 1,
  "id": "study-room",
  "canvas": { "width": 2560, "height": 1440 },
  "focalPoint": { "x": 0.5, "y": 0.52 },
  "backgrounds": {
    "day": "backgrounds/day.webp",
    "dusk": "backgrounds/dusk.webp",
    "night": "backgrounds/night.webp",
    "fallback": "backgrounds/fallback.webp"
  },
  "windowMask": "masks/window-mask.png",
  "foregrounds": [
    { "id": "desk", "src": "foregrounds/desk.webp", "z": 5 },
    { "id": "props", "src": "foregrounds/props.webp", "z": 5 }
  ],
  "anchors": {
    "girl": { "x": 0.49, "y": 0.81, "scale": 1 },
    "pet": { "x": 0.66, "y": 0.83, "scale": 1 },
    "focusHud": { "x": 0.86, "y": 0.43, "scale": 1 },
    "speechBubble": { "x": 0.69, "y": 0.68, "scale": 1 }
  },
  "safeAreas": {
    "topHud": { "x": 0.02, "y": 0.02, "width": 0.96, "height": 0.08 },
    "bottomDock": { "x": 0.28, "y": 0.89, "width": 0.44, "height": 0.09 }
  }
}
```

场景切换只加载新的 scene Manifest。

## 13. 动画 Manifest

不要再使用简单的 `Record<string, string>` 直接指向文件，升级成描述对象：

```ts
type AnimationRenderer = 'css' | 'video' | 'lottie' | 'rive' | 'sprite';

interface AnimationDescriptor {
  renderer: AnimationRenderer;
  src?: string;
  poster?: string;
  loop: boolean;
  durationMs?: number;
  playbackRate?: number;
  returnTo?: string;
  reducedMotionPoster?: string;
}
```

宠物示例：

```json
{
  "schemaVersion": 2,
  "id": "green-blob",
  "canvas": { "width": 512, "height": 512 },
  "anchor": { "x": 0.5, "y": 0.9 },
  "animations": {
    "idle": {
      "renderer": "video",
      "src": "animations/idle-loop.webm",
      "poster": "posters/idle.webp",
      "loop": true,
      "reducedMotionPoster": "posters/idle.webp"
    },
    "sleep_enter": {
      "renderer": "video",
      "src": "animations/sleep-enter.webm",
      "poster": "posters/idle.webp",
      "loop": false,
      "returnTo": "sleep_loop"
    },
    "sleep_loop": {
      "renderer": "video",
      "src": "animations/sleep-loop.webm",
      "poster": "posters/sleep.webp",
      "loop": true
    },
    "wake": {
      "renderer": "video",
      "src": "animations/wake.webm",
      "poster": "posters/sleep.webp",
      "loop": false,
      "returnTo": "idle"
    }
  }
}
```

兼容现有 v1 角色包：当动画值是字符串时，Normalizer 转成 CSS descriptor，不要求一次性破坏旧包。

## 14. 资源格式规范

### 静态背景

- 优先 WebP。
- 主背景 2560 × 1440。
- 最低 1920 × 1080。
- sRGB。
- 单张建议不超过 1.5MB。
- 不包含 UI、文字、时钟、宠物气泡。
- 同一场景的 day / dusk / night 使用相同镜头和家具位置。

### 透明角色动画

- 优先 WebM VP9 alpha，24 或 30fps。
- 角色画布保持固定。
- 视频元素设置 `muted`、`playsInline`。
- 每个视频必须有静态 WebP poster。
- 在目标 Tauri WebView 中检查 alpha 支持。
- 如果透明视频兼容性不稳定，改用 Rive、Lottie 或 PNG 序列。
- 不使用 GIF，文件大且颜色与透明边缘差。

### 天气动画

- 透明 WebM 或可循环 PNG 序列。
- 5 至 12 秒无缝循环。
- 不包含场景背景。
- 雨和雪分别提供后层与近景层。
- 窗外天气后层必须应用场景 window mask。

### 图标

- 当前使用 Lucide。
- 后续自定义图标统一 24 × 24 viewBox。
- SVG stroke 风格保持一致。
- 不混用 3D 图标、emoji 和线性图标。

## 15. AI 生成资产的一致性要求

不要用文本生成方式独立生成每段动画，否则角色脸、服装、比例和镜头会变化。

正确流程：

1. 先生成角色设定图或标准 idle 图。
2. 确认角色颜色、比例、服装和视角。
3. 后续动画全部使用同一参考图进行 image-to-video。
4. 锁定相同种子、镜头、画幅和光线方向。
5. 每段动作从标准姿势开始或结束。
6. 用后期工具去背景或导出 alpha。
7. 统一裁切到相同画布。
8. 为每段视频导出 poster。

所有背景变体同样从一个 canonical master 生成：

- 房间 day 为基础图。
- dusk 和 night 使用 image-to-image 只修改光线与窗外天空。
- 家具位置、窗框、桌面和相机不能变化。
- 图书馆单独建立一个 canonical master。

## 16. 学习房间场景

房间是默认场景。

构图：

- 大窗户位于中左区域。
- 木色桌面横跨画面下半部分。
- 小女孩位于画面中心偏左。
- 宠物位于女孩右侧桌角。
- 右侧留出 Focus HUD 可读空间。
- 顶部留出状态栏空间。
- 底部中心留出 Dock 空间。

场景元素：

- 窗户。
- 窗帘。
- 远山或城市远景。
- 木桌。
- 台灯。
- 咖啡杯。
- 盆栽。
- 两到三本书。
- 打开的笔记本。
- 少量墙面装饰。

不要让背景本身出现宠物、女孩或可读文字，这些要独立分层。

## 17. 图书馆场景

图书馆是第二个完整场景，不是给房间背景换一张壁纸。

构图：

- 左右或后方有高书架。
- 中间是一张长木桌。
- 小女孩仍位于中央偏左，动作与房间场景复用。
- 宠物可坐在书堆旁或桌角。
- 一扇大窗或高窗用于显示昼夜和天气。
- 右侧继续预留 Focus HUD。

氛围：

- 安静、开阔、少量暖灯。
- 书脊颜色低饱和，不形成彩虹墙。
- 不显示可读书名。
- 不放大量背景人物。
- 可以有一两个模糊远景剪影，但不能抢主体。
- 夜晚灯光更暖，窗外更暗。

图书馆使用独立 window mask 和 actor anchors。

## 18. 场景切换

顶部 HUD 提供“房间 / 图书馆”场景选择。

切换过程：

1. 预加载目标背景 poster。
2. 新背景准备完成后开始 700ms crossfade。
3. 角色先保持静态 poster 或 idle。
4. 背景完成切换后，按新锚点移动角色。
5. 角色位置过渡 420ms。
6. 启动新场景的 idle 动画。

切换时不能出现：

- 白屏。
- 资源未加载图标。
- 女孩先跳到错误位置。
- 宠物留在旧场景锚点。
- 两个视频同时播放声音。

## 19. 时间阶段

默认跟随本地时间：

```ts
06:00–15:59 => day
16:00–18:59 => dusk
19:00–05:59 => night
```

设置面板提供：自动、白天、黄昏、夜晚，用于 Demo 预览。

切换时：

- 背景图 crossfade 800ms。
- HUD 颜色同时切换。
- 夜晚增加不超过 0.10 的整体暗层。
- 台灯光层在夜晚加强。
- 不瞬间替换导致闪烁。

## 20. 晴天

- 不播放天气视频。
- 只保留非常缓慢的云层。
- 白天可有 2 至 3 只远处飞鸟。
- 黄昏减少飞鸟。
- 夜晚隐藏飞鸟，显示星星或薄云。
- 动画保持低频。

## 21. 下雨

雨必须分层：

```text
rain-back     窗外远雨，应用 window mask
rain-glass    玻璃水滴与细小流痕，应用 window mask
room-light    室内轻微变暗
```

规则：

- 雨线不能穿过窗框进入室内。
- 不在整个页面顶层下雨。
- HUD 上不能出现水滴。
- 雨线角度统一，速度不要过快。
- 玻璃水滴透明度低于 0.32。
- 室内亮度降低 4% 至 7%。
- 台灯亮度略提高。
- 可以让远山对比度降低，模拟雨雾。
- 当前 Demo 不播放真实雨声音频，只显示音效状态。

## 22. 下雪

雪同样分层：

```text
snow-back     窗外远景小雪，应用 window mask
snow-near     靠近玻璃的少量大雪片，仍限制在窗户区域
snow-light    室内偏冷的反射光
```

规则：

- 远景雪花小、慢、密度中低。
- 近景雪花最多 8 至 12 片同时可见。
- 不使用巨大白色圆点覆盖画面。
- 雪不能落在桌面、女孩和宠物前面，除非以后增加开窗场景。
- 室内光线偏冷，但台灯区域仍然温暖。
- 夜晚雪景可提升窗外亮度，不能纯黑。

## 23. 天气选择

顶部 HUD 放一个紧凑天气菜单：晴、雨、雪。

- 使用 Sun、CloudRain、Snowflake 图标。
- 菜单只改变本地 Demo 状态。
- 当前天气图标始终可见。
- 不显示天气预报数据。
- 不调用网络天气 API。
- 后续真实接入天气服务时，只替换状态来源，不改 WeatherRenderer。

## 24. 小女孩动画通道

女孩与宠物必须是独立播放器。

语义动作：

```ts
type GirlAction =
  | 'idle'
  | 'writing'
  | 'stretch'
  | 'drink'
  | 'turn_page'
  | 'look_outside';
```

建议片段：

| 动作 | 类型 | 时长 | 完成后 |
|---|---|---:|---|
| idle | 循环 | 4–6 秒 | idle |
| writing | 循环 | 4–7 秒 | writing |
| stretch | 单次 | 2.5–3.5 秒 | writing |
| drink | 单次 | 2–3 秒 | writing |
| turn_page | 单次 | 1.5–2.5 秒 | writing |
| look_outside | 单次 | 2–4 秒 | idle 或 writing |

动作衔接：

```text
idle -> writing
writing -> stretch -> writing
writing -> drink -> writing
writing -> turn_page -> writing
idle -> look_outside -> idle
```

生成要求：

- 所有片段使用同一女孩参考图。
- 同一服装。
- 同一桌面锚点。
- 同一相机角度。
- 不在角色视频里生成背景。
- 起始与结束姿势可自然衔接。
- 手指错误严重的片段不要使用。

本次没有正式视频时，使用透明 PNG poster + 轻微 CSS 呼吸和手部摆动。

## 25. 小宠物动画通道

语义动作：

```ts
type PetAction =
  | 'idle'
  | 'greet'
  | 'cheer'
  | 'concerned'
  | 'sleep_enter'
  | 'sleep_loop'
  | 'wake'
  | 'look_at_girl';
```

状态衔接：

```text
idle -> sleep_enter -> sleep_loop
sleep_loop -> wake -> idle
idle -> greet -> idle
idle -> cheer -> idle
idle -> concerned -> idle
idle -> look_at_girl -> idle
```

优先级：

```text
100 用户直接点击或命令
90  专注完成
80  需要回应的问题
60  场景切换
30  定时动作
10  idle / sleep_loop
```

高优先级动作可以打断低优先级循环，但不能直接从睡姿跳到站立招手。必须先播放 wake，再播放 greet。

本次没有正式宠物视频时，继续使用 CSS 小绿团完成这些状态。

## 26. 动画播放器

建立统一 `AnimationRenderer`：

```tsx
<AnimationRenderer
  actor="pet"
  action="sleep_loop"
  descriptor={resolvedAnimation}
  onReady={handleReady}
  onComplete={handleComplete}
  onError={handleFallback}
/>
```

Renderer 根据 descriptor 选择：

- CSS fallback。
- `<video>`。
- Lottie。
- Rive。
- sprite sequence。

上层角色组件不关心具体渲染技术。

视频规则：

- `muted`。
- `playsInline`。
- loop 只由 descriptor 控制。
- 单次动作通过 `ended` 进入 `returnTo`。
- 播放失败显示 poster。
- poster 失败显示 CSS fallback。
- 切换资源前先确认新资源 ready，避免闪空。

## 27. 动画队列

每个 actor 单独维护：

```ts
interface ActorPlaybackState {
  currentAction: string;
  queuedAction?: string;
  priority: number;
  status: 'loading' | 'playing' | 'paused' | 'failed';
}
```

宠物和女孩互不覆盖：

```text
pet.sleep_loop 可以与 girl.writing 同时播放
pet.cheer 可以与 girl.stretch 同时播放
pet.greet 不应重置 girl.writing
girl.drink 不应隐藏宠物气泡
```

每个 actor 最多保留一个待播放动作，避免事件积压导致几分钟后才播放过期动画。

## 28. Agent 集成原则

Agent 不直接控制资源。

错误方式：

```json
{
  "animation": "/assets/pet/sleep-final-02.webm"
}
```

正确方式：

```json
{
  "actor": "pet",
  "action": "sleep",
  "speech": null
}
```

然后由确定性映射转换：

```text
pet.sleep -> sleep_enter -> sleep_loop
pet.greet while sleeping -> wake -> greet -> idle
girl.stretch -> stretch -> writing
```

## 29. Agent 与规则的职责

不调用模型的动作：

- 空闲一段时间后宠物睡觉。
- 开始专注后女孩写作业。
- 专注完成后女孩伸懒腰。
- 每隔一段时间女孩翻书或喝水。
- 场景和天气按用户选择切换。
- 夜晚自动切换背景。

可以调用 Agent 的情况：

- 用户对宠物说自然语言。
- Agent 需要生成一句短陪伴文案。
- 用户说“你也休息吧”并需要识别为宠物睡觉意图。
- 用户说“换到图书馆”“下点雨”并需要解析成场景命令。

模型输出必须经过 JSON Schema 和 allowlist：

```ts
interface SceneAgentIntent {
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
```

任何未知 actor、action、文件路径、URL 或脚本都要拒绝并回退为 `none`。

## 30. 当前项目中的 Agent 关系

保留当前方向：

```text
确定性规则决定何时发生互动
InteractionPolicy 决定是否允许打扰
Agent / ModelRouter 只生成短文案或解析明确用户意图
Scene Director 将语义意图映射为动画状态
Asset Resolver 将动画状态映射为具体资源
```

现有 `CompanionAnimation`、`CompanionInteraction.animationName`、角色包 `animations` 和 `data-animation` 可以继续沿用。

需要注意：女孩动画不属于 `companion_interactions`，不要把女孩写字、伸懒腰记录进宠物互动表。它们是临时场景视觉状态。

## 31. 事件映射

| 业务/环境事件 | 宠物 | 女孩 | 环境 | 台词 |
|---|---|---|---|---|
| AppEntered | greet | idle | 当前时间天气 | 可选短句 |
| FocusSessionStarted | idle | writing | 轻微压暗 HUD | 默认静默 |
| FocusSessionCompleted | cheer | stretch | 恢复亮度 | 可选短句 |
| FocusSessionAborted | concerned | idle | 不变 | 平实短句 |
| Idle 20 分钟 | sleep_enter → sleep_loop | idle | 不变 | 无 |
| 用户点击睡着宠物 | wake → greet | 不变 | 不变 | 点击后短句 |
| 用户切换图书馆 | idle | idle | scene.library | 无 |
| 用户选择下雨 | 不变 | 不变 | weather.rain | 无 |
| 夜晚到来 | 可睡觉 | idle | time.night | 无 |

专注期间可以播放安静的 ambient 动画，但不主动弹气泡。

## 32. 顶部 HUD

全屏后新增轻量顶部 HUD，高度 52px。

左侧：

- 叶片或小屋图标。
- “心流小筑”。
- 当前场景名称，例如“书房”。

右侧：

- 场景选择：房间 / 图书馆。
- 天气选择：晴 / 雨 / 雪。
- 日期，例如“8月3日 周一”。
- 本地时间，例如“21:08”。
- 音量图标。

样式：

- 不要一整条不透明导航背景。
- 可以在文字区域使用局部 88% 纸白或深色半透明底。
- 单项高度 36px。
- 圆角 10px。
- 图标 18px。
- HUD 距顶部和左右各 18px 至 24px。
- 根据背景明暗切换浅色或深色文字主题。

## 33. Focus HUD

非全屏版本的右侧完整面板改为叠加式 Focus HUD。

位置：

- 右侧 26px 至 34px。
- 垂直中心略偏上。
- 宽 260 至 288px。
- 不占据独立网格列。

内容：

```text
下一段
25:00
线性代数 · 第三章
[开始专注]
今天 2 段 · 50 分钟
```

样式：

- 背景根据场景自动选择浅色或深色半透明版本。
- backdrop blur 不超过 10px。
- 边框 1px。
- 圆角 12px。
- padding 20px。
- 宽度固定，数字切换不改变布局。

计时器：

- 直径 172 至 188px。
- 轨道 6px。
- 不使用彩虹环。
- 数字 52px。
- idle 只做极轻呼吸。

专注 active：

- Focus HUD 稍微提高不透明度。
- 顶部场景切换控件降低存在感。
- 女孩进入 writing。
- 宠物保持安静。
- 天气动画降速或降低透明度 15%，避免分心。

## 34. 底部 Dock

固定底部中央：

- 宽 520 至 560px。
- 高 66px。
- bottom 18px。
- 背景使用 92% 至 96% 不透明度。
- 圆角 16px。
- 六个入口等宽。

入口：

| 文案 | 图标 |
|---|---|
| 今天 | ListTodo |
| 专注 | Timer |
| 知识 | LibraryBig |
| 复盘 | ChartNoAxesColumnIncreasing |
| 陪伴 | Sprout |
| 设置 | Settings2 |

每项只显示一个 20px 图标和一个 11px 标签，不显示第二行说明。

active 状态使用浅绿底和 2px 状态线。hover 最大上移 1px。

## 35. lo-fi 音乐条

固定右下角：

- 宽 224 至 244px。
- 高 48px。
- right 20px。
- bottom 20px。
- 不与 Dock 重叠。

内容：

- 播放/暂停图标。
- 曲名“Quiet Window”。
- 小字根据场景变化：`书房 · 雨声`、`图书馆 · 安静`。
- 五根均衡器。

当前 Demo 不播放真实音频，仅切换视觉状态。

未来音频状态也通过语义键解析，例如 `ambient.rain`, 不把音频路径放进组件。

## 36. 宠物气泡

气泡属于独立 HUD 层，不烘焙进宠物视频。

- 锚定宠物 Manifest 的 speechBubble 位置。
- 宽 168 至 210px。
- 不遮挡 Focus HUD。
- 点击后出现。
- 进入 180ms。
- 停留 1800 至 2600ms。
- 退出 160ms。
- 最多显示一句 30 字以内中文。
- 专注 active 时不主动出现。

## 37. 六个副面板

继续采用底部滑出副面板，不切换路由。

通用：

- 宽 `min(1040px, calc(100vw - 64px))`。
- 最大高度 `min(66dvh, 620px)`。
- 位于 Dock 上方 16px。
- 背景高不透明，保证可读。
- 顶部圆角 16px。
- 遮罩透明度 0.22。
- 打开时场景保留可辨认轮廓。
- 暂停不必要的近景天气和飞鸟动画。
- Esc、遮罩、X、再次点击 Dock 均可关闭。
- 打开后焦点进入面板，关闭后回到 Dock。

## 38. 今天面板

- 左侧任务列表。
- 顶部临时添加输入。
- 任务分组与预计时间。
- 右侧今天节律时间轴。
- 所有数据只在本地 state。
- 不连接 Todo store。
- 不为每行任务创建卡片。

示例：

```text
线性代数 · 第三章                    2 / 4
□ 整理特征值定义                     20 min
□ 做三道例题                         35 min
■ 标出卡住的步骤                     10 min
□ 写一张复习卡                       15 min
```

## 39. 专注面板

- idle：时长 15 / 25 / 45 / 60、任务、环境音、开始按钮。
- active：只保留大计时、备注、暂停和放弃。
- paused：继续和结束。
- elapsed：提示“时间到了，慢慢收个尾。”。
- 不自动完成。
- 不放烟花。
- 状态只影响 Demo Scene Director。

## 40. 知识面板

- 搜索框。
- 最近搜索 chips。
- 两张笔记结果卡。
- 一列可能相关文本。
- 不调用 RAG。
- 不显示假 AI 在线状态。

## 41. 复盘面板

- 日 / 周 / 月 segmented control。
- 左侧摘要列表。
- 右侧“留给下一次”。
- “整理成复习卡”只做本地反馈。
- 不调用模型。

## 42. 陪伴面板

- 复用同一个宠物 Renderer。
- 可预览 idle、greet、cheer、sleep、wake。
- 展示最近四条本地气泡。
- 可以提供一个“动画预览”选择器，仅用于 Demo。
- 不做完整聊天软件。

## 43. 设置面板

增加场景相关设置：

场景：

- 默认场景：房间 / 图书馆。
- 跟随本地时间。
- 时间预览：自动 / 白天 / 黄昏 / 夜晚。
- 天气：晴 / 雨 / 雪。
- 场景亮度。
- 显示环境动画。
- 减少动态效果。

陪伴：

- 显示小宠物。
- 允许宠物自动休息。
- 专注中保持安静。

模型字段仍为只读 Demo，不调用真实模型。

## 44. 设计 Token

```css
:root {
  --hud-light: rgba(251, 250, 246, 0.92);
  --hud-dark: rgba(36, 45, 41, 0.90);
  --hud-border-light: rgba(255, 255, 255, 0.28);
  --hud-border-dark: rgba(41, 51, 47, 0.16);
  --text-light: #f8f7f1;
  --text-dark: #29332f;
  --text-muted-light: rgba(248, 247, 241, 0.72);
  --text-muted-dark: #68716c;
  --accent: #557761;
  --accent-hover: #486852;
  --accent-soft: #dbe7dd;
  --coral: #d47f70;
  --yellow: #e1b968;
  --danger: #9c4a3f;
  --radius: 10px;
  --shadow-hud: 0 14px 34px rgba(22, 29, 25, 0.16);
  --shadow-panel: 0 24px 64px rgba(22, 29, 25, 0.24);
}
```

不要使用紫蓝霓虹、大面积玻璃拟态或装饰性渐变 orb。

## 45. 字体

使用系统字体，不加载远程字体。

- 品牌 16px。
- HUD 标题 14px。
- 主计时 52px。
- 面板标题 22px。
- 正文 14px。
- 次要文字 12px。
- Dock 标签 11px。
- 所有 letter-spacing 为 0。
- 时间使用 tabular numbers。
- 不使用随 viewport 宽度连续缩放的字号。

## 46. 资源预加载

首屏优先：

1. 当前场景当前时间背景。
2. 女孩当前 poster 或 writing 动画。
3. 宠物 idle poster 或 idle 动画。
4. Focus HUD 和 Dock。

随后预加载：

1. 当前场景相邻时间背景。
2. 宠物 greet 和 sleep_enter。
3. 女孩 stretch。
4. 当前天气动画。

延迟加载：

- 第二场景全部资源。
- 不常用角色动作。
- 雪景或雨景中未选择的那一组。

不要启动时同时解码所有 WebM。

## 47. 内存与性能

- 同一个 actor 同时只保留一个活动视频元素。
- Crossfade 时最多短暂保留两个背景。
- 非当前场景视频必须暂停并释放 src。
- 页面不可见时暂停天气、角色循环和均衡器。
- 装饰 CSS 动画只改变 transform 和 opacity。
- 不在 React 中每帧更新位置。
- 不为雪花创建大量 DOM 节点。
- 视频建议 24fps，避免无必要的 60fps。
- 1080p 天气 overlay 不需要 4K。

## 48. 降级链

必须按顺序降级：

```text
指定动画资源
-> poster 静态图
-> CSS fallback
-> 简单色块占位
```

背景降级：

```text
当前时间背景
-> scene fallback.webp
-> CSS 场景底色
```

资源失败只记录开发日志，不在用户界面显示破坏沉浸感的错误堆栈。

## 49. reduced motion

系统开启 reduced motion 时：

- 不自动播放天气视频。
- 不播放角色循环视频。
- 使用 poster。
- 不显示飞鸟和持续均衡器。
- 面板改为短 opacity 过渡或无动画。
- 关键状态仍通过静态画面和文字表达。

## 50. 可访问性

- 根节点 `<main>`。
- Top HUD 使用 `<header>`。
- Dock 使用 `<nav aria-label="功能入口">`。
- Focus HUD 使用 `<aside aria-label="专注计时">`。
- 音乐条使用 `<aside aria-label="lo-fi 音乐">`。
- 场景和天气选择可用键盘操作。
- 图标按钮有 aria-label。
- 宠物是 button，不是 clickable div。
- 副面板使用 dialog 语义和焦点管理。
- 视频和图片是装饰时 `aria-hidden="true"`。
- 场景变化用简短的非打扰状态文本提供给辅助技术。
- 所有 HUD 在白天、黄昏、夜晚背景上均达到可读对比度。

## 51. 推荐代码结构

```text
src/ui/demo/fullscreen-cozy-home/
├── FullscreenCozyHome.tsx
├── fullscreen-cozy-home.css
├── types.ts
├── scene-director.ts
├── asset-resolver.ts
├── manifest-normalizer.ts
├── components/
│   ├── SceneViewport.tsx
│   ├── SceneBackground.tsx
│   ├── TimeLightingLayer.tsx
│   ├── WeatherRenderer.tsx
│   ├── WindowMaskedLayer.tsx
│   ├── ActorRenderer.tsx
│   ├── AnimationRenderer.tsx
│   ├── GirlActor.tsx
│   ├── PetActor.tsx
│   ├── TopHud.tsx
│   ├── FocusHud.tsx
│   ├── FeatureDock.tsx
│   ├── LofiHud.tsx
│   ├── SpeechBubble.tsx
│   └── DemoSheet.tsx
└── panels/
    ├── TodayPanel.tsx
    ├── FocusPanel.tsx
    ├── KnowledgePanel.tsx
    ├── ReviewPanel.tsx
    ├── CompanionPanel.tsx
    └── SettingsPanel.tsx
```

如果没有正式资源，仍按相同组件结构使用 CSS fallback，不创建第二套 Demo。

## 52. 当前 Demo 控制

为了方便评审，必须可以在页面内切换：

- 房间 / 图书馆。
- 晴 / 雨 / 雪。
- 自动 / 白天 / 黄昏 / 夜晚。
- 女孩 writing / stretch / drink / turn_page。
- 宠物 idle / greet / cheer / sleep / wake。
- Focus idle / active / paused / elapsed。

女孩和宠物动作预览放在“陪伴”或“设置”副面板，不要把开发调试按钮堆在主场景上。

## 53. 禁止项

- 不要继续把场景放在居中的非全屏大卡片里。
- 不要保留独立右侧网格列。
- 不要让背景周围露出大面积页面底色。
- 不要把 UI 烘焙进背景图。
- 不要把女孩和宠物烘焙进场景背景。
- 不要让雨雪穿过窗户进入室内。
- 不要把 Agent 输出直接当文件路径。
- 不要让 Agent 输出任意 action 并直接执行。
- 不要让女孩和宠物共用一个动画状态字段。
- 不要同时播放多个同角色视频。
- 不要使用 GIF 作为主动画格式。
- 不要从远程 URL 加载随机图片。
- 不要卡片套卡片。
- 不要在页面显示“Demo”“占位”“暂未接入”等说明。
- 不要用 emoji 代替图标。
- 不要让 HUD 与 Dock、气泡或人物重叠。
- 不要修改真实业务和 Rust 后端。

## 54. 实施顺序

1. 阅读项目和相关 skill。
2. 确认当前非全屏 Demo 的组件关系。
3. 新建全屏 Demo，不覆盖真实应用。
4. 建立 SceneState、VisualCue 和 Manifest 类型。
5. 建立全屏 SceneViewport 和图层系统。
6. 实现 CSS fallback 房间。
7. 实现 CSS fallback 图书馆。
8. 实现 day / dusk / night。
9. 实现 window mask 与 rain / snow fallback。
10. 实现 GirlActor 独立通道。
11. 实现 PetActor 独立通道。
12. 实现 ActorRenderer 和降级链。
13. 实现 Top HUD、Focus HUD、Dock 和 Lofi HUD。
14. 实现六个底部副面板。
15. 加入本地动作和场景预览控制。
16. 如果用户提供正式资产，再接入 Manifest，不改变布局。
17. 检查五个桌面尺寸。
18. 检查资源加载失败和 reduced motion。
19. 运行类型检查和构建。

## 55. 视觉验收

- 场景真正覆盖整个窗口。
- 页面不再像“背景色中的一个房间模块”。
- HUD 看起来悬浮在环境中，但可读。
- 小女孩是主要视觉焦点。
- 宠物位置自然，不挡任务和时钟。
- 房间和图书馆能明显区分。
- 白天、黄昏、夜晚视觉明确。
- 雨和雪只在合理的窗外或玻璃层出现。
- 场景切换无白屏。
- 角色动作切换不跳位置。
- Focus HUD 不占独立列，但始终可读。
- Dock 和音乐条不重叠。
- 副面板打开后背景仍可辨认。
- 中文不乱码、不裁切、不重叠。

## 56. 动画验收

- pet idle 可以循环。
- pet sleep 正确走 `sleep_enter -> sleep_loop`。
- 点击睡着宠物正确走 `wake -> greet -> idle`。
- girl writing 可以循环。
- girl stretch 完成后回到 writing。
- pet 和 girl 可以同时播放不同动画。
- 高优先级动作能打断低优先级循环。
- 同一个 actor 不会同时出现两个视频。
- 单个资源失败会回退 poster 或 CSS。
- reduced motion 使用静态 poster。
- 切换场景后角色使用新锚点。

## 57. Agent 契约验收

- Agent 只输出语义 actor/action。
- Agent 不能输出路径、URL、脚本或组件名。
- 所有 action 经过 allowlist。
- 睡觉、写作业、伸懒腰等常规动作不调用模型。
- 专注中 InteractionPolicy 仍阻止主动气泡。
- 静默视觉动作不被错误当成对话互动。
- 女孩动作不写入 companion interaction 表。
- 资源 Manifest 替换不影响 Agent。

## 58. 代码验收

完成后运行：

```text
npm run typecheck
npm run build
```

确认 Demo 没有调用：

```text
@tauri-apps/api
invoke
useTodoStore
useFocusStore
useNoteStore
useCompanionStore
createTauriRuntime
TauriSqlDriver
TauriModelProvider
```

真实接线留到后续阶段。

## 59. 截图验收

检查：

```text
1920 × 1080
1600 × 900
1440 × 900
1366 × 768
1280 × 720
```

每个尺寸至少截图：

- 房间白天晴天。
- 房间夜晚下雨。
- 图书馆白天下雪。
- Focus active。
- 宠物睡觉。
- 女孩伸懒腰。
- 任意一个副面板打开。

检查截图中没有 HUD、角色、气泡和 Dock 重叠。

## 60. 最终交付说明

完成后汇报：

1. 全屏结构如何替代旧的非全屏模块。
2. 场景、天气、人物、宠物分别有哪些独立图层。
3. 创建了哪些 Manifest 和资源插槽。
4. 当前使用了哪些正式资产，哪些使用 fallback。
5. 房间、图书馆、雨、雪和昼夜如何切换。
6. 女孩和宠物动画如何独立调度。
7. Agent 如何通过语义 VisualCue 接入。
8. 明确说明本次没有连接真实数据库、模型和 Tauri。
9. 类型检查、构建和五种桌面尺寸检查结果。

不要仅以“可以编译”作为完成标准。最终必须以全屏截图、动画切换、资源降级和无重叠为判断依据。

## 提示词正文结束

---

## 资产生成附录

以下提示词用于后续单独生成资产，不要求编码代理在没有图像或视频工具时强行完成。

### A. 统一风格前缀

```text
Refined Japanese picture-book editorial illustration for a calm desktop lofi study application, soft flat shapes, subtle paper grain, restrained shading, balanced muted palette of sage green, sky blue, warm gray, medium wood and small coral accents, clean silhouettes, gentle cinematic ambient light, adult-friendly cute, no thick black outline, no text, no UI, no logo, no neon colors, no plastic 3D style.
```

### B. 全屏学习房间背景

```text
Create a 16:9 full-screen cozy study room background for a desktop productivity application. A large window occupies the center-left wall, with a clear view outside. A long medium-wood desk crosses the lower part of the frame. Include a restrained desk lamp, two books, a ceramic cup, a small plant and a few quiet wall decorations. Leave the center-left desk area empty for a separately composited seated study character. Leave the right side visually calm for a floating focus timer HUD. Leave the bottom center calm for a navigation dock. Keep all important objects within the central 84 percent safe area. Fixed camera, straight architectural perspective, no person, no pet, no readable text, no clock, no UI. 2560x1440.
```

### C. 图书馆背景

```text
Create a 16:9 full-screen quiet library background for a desktop lofi study application. Tall muted bookshelves frame the left and rear walls, a long wooden reading table occupies the lower middle, and a large arched or rectangular window shows the outside weather. Keep the center-left chair and desk position open for a separately composited student character. Keep a small table area open for a pet. Leave the right side calm and low-detail for a focus timer HUD, and the bottom center clear for a dock. Warm reading lamps, balanced cool window light, low-saturation book spines, no crowd, no readable book titles, no person, no pet, no UI, no text. Fixed camera. 2560x1440.
```

### D. 小女孩基础角色

```text
Create a transparent-background character reference for a desktop lofi study scene. A calm young woman sits at a desk in a three-quarter side view, quietly writing in an open notebook. Natural adult proportions, dark brown shoulder-length hair or low ponytail, muted sage knitted cardigan, ivory inner shirt, tiny restrained coral hair clip. Her left hand rests on the page and her right hand holds a pencil. The pose must align naturally to a horizontal desk anchor. Soft Japanese editorial picture-book style, clean silhouette, subtle paper grain, no thick outline, no background, no desk except the minimum notebook and hand contact reference, no text, no cropped head or arms.
```

### E. 女孩伸懒腰动画要求

```text
Use the supplied character reference and exact camera framing. Begin in the established writing pose at the desk. She pauses, places the pencil down, gently raises both shoulders and arms for a natural quiet stretch, relaxes, and returns exactly to the original writing pose. Calm movement, no exaggerated yawn, no camera movement, no body or clothing changes, no background, transparent output, 24fps, 3 seconds, first and final frame compatible with the writing loop.
```

### F. 小绿团基础角色

```text
Create a transparent-background small round green companion character for a calm desktop study application. Soft asymmetrical blob body, muted leaf green, tiny dark eyes, restrained curved mouth, subtle coral blush, one small two-leaf sprout on top. Adult-friendly cute, simple clean silhouette, no legs or only tiny soft base bumps, no accessories, no text, no background, no thick outline, no shiny plastic 3D appearance. Centered on a 512x512 canvas with the ground anchor fixed near 90 percent height.
```

### G. 宠物睡觉动画要求

```text
Use the supplied green companion reference and fixed 512x512 transparent canvas. Start from the exact idle pose. The small green companion slowly lowers its body, lets the sprout relax, gently lies down and closes its eyes. End in a stable sleeping pose suitable for transition into a seamless breathing sleep loop. No camera movement, no character design changes, no background, no text, 24fps, 1.5 seconds.
```

### H. 宠物睡眠循环要求

```text
Use the exact final sleeping pose from the sleep-enter animation. Create a seamless transparent sleep loop with only subtle body breathing, tiny sprout movement and an occasional very small sleepy motion. The first and final frames must match exactly. No camera movement, no background, no text, 24fps, 4 seconds.
```

### I. 雨层要求

```text
Create a seamless transparent rain overlay for a fixed indoor-window scene. Fine diagonal distant rain with restrained density, soft atmospheric depth, no lightning, no storm, no background scenery, no window frame, no text. Designed to be clipped by a separate window mask. 1920x1080, 24fps, 8-second seamless loop.
```

### J. 雪层要求

```text
Create a seamless transparent gentle snowfall overlay for a quiet indoor-window scene. Small distant snowflakes move slowly with natural variation; only a few slightly larger near flakes, restrained density, no blizzard, no background scenery, no window frame, no text. Designed to be clipped by a separate window mask. 1920x1080, 24fps, 10-second seamless loop.
```
