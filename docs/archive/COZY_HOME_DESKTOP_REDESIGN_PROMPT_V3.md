# NativeMind「心流小筑」桌面端视觉 Demo 完整提示词 V3.1

> 适用范围：Windows / macOS 桌面端 Tauri 应用。
>
> 本版本不设计手机端，不改变现有页面架构，只制作可替换美术资产的视觉 Demo。
>
> 使用方式：将“提示词正文开始”至“提示词正文结束”完整交给 Claude Code、Codex 或其他代码代理。

---

## 提示词正文开始

你是 NativeMind 项目的资深产品设计师、桌面应用设计师、插画视觉设计师和 React 前端工程师。

请重新设计并实现 NativeMind 的“心流小筑”桌面端主页面 Demo。当前页面的整体信息架构已经确认可用，不要推翻：继续保留左侧大幅学习房间场景、右侧时钟与专注区域、底部功能 Dock、右下角 lo-fi 音乐条，以及点击 Dock 后从底部出现的六个副面板。

这次需要重做的是视觉品质，不是页面架构。不要把页面改成另一种导航方式，不要改成手机布局，不要接入真实业务，也不要因为现有代码能运行就只做换色。

最终结果应像一款成熟的桌面学习辅助软件：安静、简洁、可爱、轻松，有日系绘本和 lo-fi 学习房间的陪伴感，但仍然适合成年人长期使用。

## 1. 任务目标

重设计一个纯展示的桌面端主页面 Demo，主要包含：

- 左侧占大部分面积的学习房间主场景。
- 窗外天空随本地时间变化：白天、黄昏、夜晚。
- 一个正在桌前安静写作业的小女孩。
- 木色桌面及台灯、书、笔记本、咖啡杯、盆栽等小物。
- 一只纯 HTML + CSS 实现的小绿团宠物。
- 右侧独立的时间与番茄钟区域。
- 底部六个功能入口：今天、专注、知识、复盘、陪伴、设置。
- 右下角 lo-fi 音乐播放条。
- 点击 Dock 后出现的六个纯展示副面板。

本次只验证页面设计、动画节奏、布局和交互体验。背景、人物图片、图标、背景动画、宠物美术和音频素材都不是最终资产；当前只需要用统一、干净的代码占位效果把页面完整展示出来。所有可操作效果都只使用 React 本地状态，刷新后允许丢失。

### 1.1 当前阶段的资产原则

这次不要生成、下载或购买正式美术资产。用户后续会使用专门软件制作背景、角色图片、图标、动画和宠物资源。

当前 Demo 统一采用以下替身：

| 最终内容 | 当前 Demo 替身 | 后续替换目标 |
|---|---|---|
| 房间背景 | CSS 色块、边框和简单几何层 | PNG / WebP / 视频 / Canvas 场景 |
| 窗外天空 | CSS 渐变、太阳、月亮、星星、云 | 序列帧、视频、Lottie 或专用背景 |
| 小女孩 | 克制的 CSS 半身剪影占位 | 透明 PNG / WebP / Rive / Lottie |
| Dock 图标 | Lucide 统一线性图标 | 自定义 SVG / PNG 图标包 |
| 小宠物 | HTML + CSS 小绿团 | Rive / Lottie / Spine / 序列帧 |
| 背景动画 | CSS transform / opacity | 视频、Canvas、PixiJS、Rive 或 Lottie |
| lo-fi 音乐 | 本地播放状态和均衡器动画 | 真实音频播放器与封面 |

当前 Demo 仍要协调、整洁、可以评审，但不要把 CSS 占位画当成最终插画。重点是验证：

- 每个资产放在哪里。
- 需要多大的画布和透明区域。
- 不同资产之间的遮挡关系。
- 昼夜状态如何切换。
- 动画从什么状态切到什么状态。
- 替换素材后是否不用重写页面布局和业务组件。

占位效果中不要显示“占位图”“稍后替换”“Demo asset”等文字。用户看到的是一个完整 Demo，资产替换信息只写在代码结构和开发文档里。

为所有未来资产保留稳定插槽：

```tsx
<div data-visual-slot="room-background" />
<div data-visual-slot="window-ambient" data-sky={skyPhase} />
<div data-visual-slot="study-character" data-state="writing" />
<button data-visual-slot="companion" data-mood={mood} />
<div data-visual-slot="lofi-cover" data-playing={lofiPlaying} />
```

插槽名称用于标记未来替换边界，不要把路径、渲染技术或业务调用写死在布局组件里。

## 2. 必须保留的页面架构

现有页面架构是正确的，禁止更换。组件关系应继续保持为：

```text
CozyHomeDemo
├── MainDesktopLayout
│   ├── AmbientStudyRoom             左侧主场景
│   │   ├── WindowScene              窗外昼夜
│   │   ├── StudyGirl                小女孩写作业
│   │   ├── WoodenDesk               木色桌面
│   │   ├── DeskLamp                 台灯
│   │   ├── DeskProps                杯子、书、盆栽、笔记本
│   │   └── GreenCompanion           CSS 小绿团
│   └── SideFocusClock               右侧时间与番茄钟
├── FeatureDock                      底部六入口
├── LofiPlayer                       右下音乐条
└── DemoPanelLayer                   底部副面板
    ├── TodayPanel
    ├── FocusPanel
    ├── KnowledgePanel
    ├── ReviewPanel
    ├── CompanionPanel
    └── SettingsPanel
```

必须保留以下行为：

- 左侧场景和右侧时钟同时出现在首屏。
- 主场景始终比右侧时钟区域大。
- Dock 固定在窗口底部中央。
- lo-fi 音乐条固定在窗口右下角。
- 点击 Dock 才显示副面板。
- 副面板从底部滑入，而不是跳转到新路由。
- `Esc`、点击遮罩、点击关闭按钮都可以关闭副面板。

禁止改成：

- 顶部导航页。
- 左侧 Sidebar 后台布局。
- 多页面路由跳转。
- 全屏只有计时器的极简页。
- 手机式底部 Tab 页面。
- 营销网站 Hero。
- 卡片瀑布流 Dashboard。

## 3. 桌面端范围

本任务只面向电脑桌面窗口，不做手机适配，不需要编写 390px、430px 等移动端布局。

主要验收尺寸：

```text
1920 × 1080
1600 × 900
1440 × 900    主设计基准
1366 × 768
1280 × 720    最小验收尺寸
```

页面应在宽度 1280px 以上、高度 720px 以上保持完整。

允许为 Demo 根节点设置：

```css
min-width: 1180px;
min-height: 680px;
```

不要花时间设计手机折叠、触摸手势、移动端抽屉和窄屏导航。桌面端只需要兼顾正常窗口缩放，重点优化鼠标、键盘、hover、focus 和窗口高度变化。

## 4. 项目架构与业务边界

NativeMind 是 Tauri + React + TypeScript 项目，真实业务链大致为：

```text
React UI
  -> Zustand store
  -> application use-case
  -> repository / model port / infrastructure port
  -> Tauri adapter
  -> Rust command
  -> SQLite / Ollama / file system / audio
```

这次 Demo 不进入这条链路。

严格禁止：

- import 或调用真实 Zustand store。
- import `src/ui/stores/runtime`。
- 调用 application use-case、repository 或 infrastructure adapter。
- 调用 `@tauri-apps/api` 或裸 `invoke`。
- 调用数据库、文件命令、音频命令或模型命令。
- 调用 Ollama、OpenAI、RAG、外部搜索或 sqlite-vec。
- 修改 `src-tauri`。
- 修改 migration。
- 修改 Rust command 名称或参数契约。
- 删除或覆盖真实应用 `src/ui/App.tsx`。
- 将 Demo 中的假数据保存到真实数据库。

允许：

- React `useState`、`useEffect`、`useMemo`、`useRef`。
- 使用 `new Date()` 获取本地时间。
- 使用 `setInterval` 完成本地时钟或纯 Demo 倒计时。
- 本地任务数组、设置开关、宠物状态、音乐视觉状态。
- CSS keyframes。
- CSS 色块、伪元素和简单剪影作为临时视觉替身。
- `lucide-react` 图标；如果未安装，可将它作为唯一新增的小型 UI 依赖。

当前阶段不做：

- 调用图像生成服务。
- 下载背景图、人物图、宠物素材、图标包或动画文件。
- 接入 Rive、Lottie、Spine、PixiJS、Three.js 或视频播放层。
- 为了占位效果新增大型动画或绘图库。
- 将临时素材存进数据库。

所有 Demo 状态刷新后都可以重置，不创建新的全局 store。

## 5. 开始前必须阅读

编码前完整阅读：

```text
package.json
src/main.tsx
src/ui/App.tsx
src/ui/styles/globals.css
src/ui/demo/CozyHomeDemo.tsx
src/ui/demo/cozy-home-demo.css

.claude/skills/nativemind-cozy-ui/SKILL.md
.claude/skills/nativemind-pomodoro-flow-ui/SKILL.md
.claude/skills/nativemind-companion-widget/SKILL.md
.claude/skills/nativemind-ambient-scene/SKILL.md
.claude/skills/nativemind-tauri-ui-contract/SKILL.md
```

如果 Demo 已被拆分到其他目录，先搜索实际路径。不要创建第二套同名页面，也不要修改无关真实页面。

## 6. 总体视觉方向

唯一视觉方向：

```text
日系柔和绘本插画
+ lo-fi 学习房间
+ 克制的桌面效率软件
+ 轻微纸张质感
+ 成人可用的可爱陪伴
```

可以参考的气质词：

```text
quiet study room
soft editorial illustration
Japanese picture-book mood
cozy lofi desk
muted balanced palette
gentle local light
calm desktop productivity
soft flat illustration
subtle tactile details
```

页面第一眼应该是“一间正在发生学习行为的房间”，而不是“一套 UI 组件”。

视觉优先级：

1. 小女孩正在写作业。
2. 窗外时间和房间氛围。
3. 右侧时钟与番茄钟。
4. 底部 Dock。
5. 小宠物和音乐条。
6. 其他小物和辅助文字。

可爱感应来自：

- 人物姿势自然。
- 小宠物表情克制。
- 色彩柔和但不单调。
- 动画小而有节奏。
- 文案像安静陪伴，而不是夸张鼓励。

可爱感不能来自：

- 所有东西都做成圆球。
- 所有容器都做成大胶囊。
- 高饱和糖果色。
- 夸张大眼和幼儿化比例。
- emoji 堆砌。
- 随处弹跳和闪烁。

## 7. 禁止的视觉风格

不要出现：

- 赛博朋克。
- 紫蓝霓虹渐变。
- 玻璃拟态大屏。
- 大面积透明毛玻璃卡片。
- 3D 黏土玩具风。
- 高饱和儿童教育软件风。
- 手游大厅。
- 像素风。
- 黑白后台管理系统。
- 营销网站大标题。
- 厚重黑色漫画描边。
- 大面积棕色、橙色或米黄色单色调。
- 装饰性渐变圆球、orb、bokeh 光斑。
- 卡片套卡片。
- 每个小区域都加阴影。
- 每个按钮都做成胶囊。
- 所有桌面物件 hover 都大幅上浮。

## 8. 精确设计 Token

在 Demo 根节点定义局部变量，整个 Demo 只能从 Token 取色，不要在几十个选择器里随意增加相似颜色。

```css
.cozy-home-demo {
  --home-bg: #eef0eb;
  --home-surface: #fbfaf6;
  --home-surface-soft: #f4f3ed;
  --home-wall: #e5e4dc;
  --home-wall-cool: #dce6df;
  --home-border: rgba(49, 61, 55, 0.14);
  --home-text: #29332f;
  --home-text-muted: #68716c;
  --home-green: #557761;
  --home-green-hover: #486852;
  --home-green-soft: #dbe7dd;
  --home-sky-day: #a8cedd;
  --home-sky-day-low: #d8e7e4;
  --home-sky-dusk: #d88978;
  --home-sky-dusk-low: #e4b873;
  --home-sky-night: #26364f;
  --home-sky-night-low: #536b78;
  --home-coral: #d47f70;
  --home-yellow: #e1b968;
  --home-blue: #769eae;
  --home-wood: #a86f4a;
  --home-wood-mid: #8f5e43;
  --home-wood-dark: #714936;
  --home-danger: #9c4a3f;
  --home-radius: 10px;
  --home-gap: 16px;
  --home-shadow-soft: 0 8px 24px rgba(42, 51, 46, 0.08);
  --home-shadow-float: 0 14px 34px rgba(42, 51, 46, 0.12);
  --home-shadow-panel: 0 24px 64px rgba(32, 40, 36, 0.18);
}
```

颜色使用比例：

- 30% 暖灰与纸白。
- 25% 天空蓝、冷灰绿。
- 18% 木色。
- 17% 深墨绿与文字色。
- 10% 珊瑚、黄色、蓝色小面积点缀。

不要让页面只剩米白 + 木棕 + 绿色。天空蓝是平衡暖色的重要组成部分，珊瑚色只作为书本、发夹、任务状态等小点缀。

圆角规则：

- 普通卡片和输入框：10px。
- 主场景外框：12px。
- 右侧时钟面板：12px。
- 底部 Dock 外框：16px。
- 副面板顶部：16px。
- 真正的标签 chip：999px。
- 圆形图标按钮和计时器：圆形。

不要再次出现 24px、28px、32px 的大面积圆角卡片。

阴影规则：

- 主场景和右侧时钟最多使用 `--home-shadow-soft`。
- Dock 使用 `--home-shadow-float`。
- 副面板使用 `--home-shadow-panel`。
- 小卡片通常只有边框，无阴影。
- 同一元素不能同时叠加内阴影、外阴影、发光和 backdrop blur。

## 9. 字体和文字层级

不加载远程字体，使用系统字体：

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system,
  BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Microsoft YaHei", sans-serif;
```

所有 `letter-spacing` 为 0。不要用负字距，也不要使用随 viewport 宽度连续变化的字号。

字号：

| 用途 | 字号 | 字重 | 行高 |
|---|---:|---:|---:|
| 品牌名称 | 16px | 650 | 1.3 |
| 右侧标题 | 22px | 650 | 1.25 |
| 本地时间 | 32px | 650 | 1 |
| 主番茄数字 | 54px | 650 | 1 |
| 副面板标题 | 22px | 650 | 1.3 |
| 分区标题 | 15px | 600 | 1.4 |
| 正文 | 14px | 400 | 1.65 |
| 次要文字 | 12px | 400 | 1.5 |
| 按钮 | 13px | 600 | 1 |
| Dock 标签 | 11px | 550 | 1.2 |

时间数字使用：

```css
font-variant-numeric: tabular-nums;
```

界面文案使用中文。不要显示：

- `Demo panel`。
- “这里目前只是视觉 Demo”。
- “不会写入真实数据”。
- “点击按钮查看功能”。
- 设计说明、技术说明或操作教程。

这些内容可以写在代码注释或交付说明中，不能显示在页面上。

## 10. 桌面整体布局

以 1440 × 900 为基准：

```css
.cozy-home-demo {
  position: relative;
  width: 100vw;
  height: 100dvh;
  min-width: 1180px;
  min-height: 680px;
  overflow: hidden;
}

.cozy-main-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  height: 100%;
  padding: 22px 22px 104px;
}
```

要求：

- 左侧场景宽度自适应，占剩余空间。
- 右侧时钟固定在 284 至 310px 之间。
- 主场景与右侧时钟顶部、底部对齐。
- 页面外边距保持 18 至 24px。
- 底部预留 96 至 108px 给 Dock。
- 1280 × 720 时不能出现纵向页面滚动条。
- 1920px 宽时场景可以变宽，但人物和时钟不能无限放大。
- 主要视觉元素使用 `max-width` 或稳定比例限制。

页面背景使用 `--home-bg`，可以添加透明度低于 0.03 的纸张纹理，但不能用大渐变光斑。

## 11. 左侧主场景容器

左侧是一个“房间视窗”，保留独立边界，但不要像一个夸张的大软卡片。

- 圆角 12px。
- 1px `--home-border`。
- overflow hidden。
- 阴影只使用 `--home-shadow-soft`。
- 背景墙为 `--home-wall`。
- 场景内部使用稳定定位，不要让物件随窗口宽度无约束漂移。

主场景纵向分区：

```text
0%   ───────────────────────── 顶部墙面
8%   ───────────────────────── 窗户顶部
52%  ───────────────────────── 窗户底部
60%  ───────────────────────── 桌面后方区域
66%  ═════════════════════════ 桌板
70%  ───────────────────────── 桌前挡板
100% ───────────────────────── 场景底部
```

主场景横向构图：

- 左 8% 至 23%：台灯、少量书本。
- 左 20% 至 72%：窗户。
- 中间 38% 至 68%：小女孩，是视觉中心。
- 右 68% 至 83%：杯子、盆栽或宠物。
- 最右 17% 留出空气，不要堆满小物。

人物不能与窗框竖线重合，头部后面应是相对干净的天空或窗帘色块。

## 12. 房间墙面与空间层次

墙面：

- 主墙使用暖灰 `--home-wall`。
- 右后侧可以使用一块低对比冷灰绿 `--home-wall-cool`，用于平衡木色。
- 墙面纹理只使用很淡的 CSS 重复线或噪点，opacity 不超过 0.035。
- 不使用规则大网格。
- 不使用装饰圆球和漂浮几何图形。

墙上最多放两类装饰：

1. 一个窄木置物架，放 3 本书和一个小陶瓶。
2. 两张不带可读小字的便签或小幅抽象画。

墙饰必须远离人物头部和右侧时钟方向，不能把背景填满。

空间必须有统一光线：

- 白天和黄昏，主光从窗户方向照入。
- 夜晚，台灯成为局部暖光。
- 阴影统一朝右下或下方。
- 不允许窗光从左、台灯阴影却向另一个不合理方向。

## 13. 窗户结构

窗户占主场景宽度约 58% 至 64%，高度约 42% 至 48%。

- 位置：left 21% 至 24%，top 7% 至 9%。
- 窗框宽 6px 至 8px。
- 窗框颜色 `--home-wood-dark`，可降低饱和度。
- 外边框圆角 8px，不做 26px 圆角。
- 内部分格线宽 4px 至 6px。
- 窗台比窗框向左右各多 12px，高 14px 至 18px。
- 窗帘只在左右两边露出少量，灰绿或灰蓝色。

窗户不应像网页中的图片卡片。不要给窗户强阴影、厚边框和发光。

## 14. 窗外昼夜变化

使用本地时间：

```ts
if (hour >= 6 && hour < 16) return 'day';
if (hour >= 16 && hour < 19) return 'dusk';
return 'night';
```

每 60 秒更新时间即可。根节点或窗景节点使用：

```tsx
data-sky={skyPhase}
```

### 白天

- 天空上部 `#a8cedd`，下部 `#d8e7e4`。
- 太阳直径 40 至 46px，位于右上 18% 至 22%。
- 太阳颜色 `#f1d690`，发光不超过 18px、opacity 0.20。
- 两朵云，大小约 90px 和 130px。
- 云透明度分别为 0.45 和 0.30。
- 远山两层，后层灰蓝、前层灰绿。
- 飞鸟只放 2 至 3 只，18 至 24 秒偶尔掠过，不要始终在原地抖动。

### 黄昏

- 上部天空 `#7f91a5`。
- 中部天空 `#d88978`。
- 下部天空 `#e4b873`。
- 太阳下降到地平线附近，透明度 0.80。
- 山体变深，但不能变成黑色剪影。
- 房间覆盖不超过 0.07 的暖色光。
- 台灯可以提前出现很弱的亮度。

### 夜晚

- 上部天空 `#26364f`。
- 下部天空 `#536b78`。
- 月亮直径 36 至 42px，偏暖灰白。
- 星星 14 至 18 颗，尺寸 1px、2px、3px 混合。
- 星星分布必须不规则，不能使用等距横排。
- 星星只改变 opacity，周期 3.2 至 5.5 秒，错开延迟。
- 隐藏太阳和飞鸟。
- 云变成一条低透明薄云，移动速度更慢。
- 房间整体压暗约 8%，不是整页变成深色模式。
- 台灯局部暖光明显，但不能产生大面积黄色光球。

天空阶段切换使用 700 至 900ms 的 opacity 或颜色过渡，不闪白。

## 15. 小女孩视觉占位

小女孩仍然是当前页面最重要的构图锚点，但本阶段不制作最终人物图片。请使用一个克制、易替换的 CSS/HTML 半身剪影占位，验证人物的尺寸、姿势、遮挡和动画位置。

占位目标不是画出完整人物细节，而是让用户一眼理解“这里有一个人在安静写作业”。宁可采用简化的侧后方剪影，也不要继续制作廉价的圆头娃娃。

推荐占位结构：

```tsx
<div
  className="study-character-slot"
  data-visual-slot="study-character"
  data-state="writing"
  aria-label="正在安静写作业的女孩"
>
  <div className="study-character-slot__chair" />
  <div className="study-character-slot__hair" />
  <div className="study-character-slot__head" />
  <div className="study-character-slot__torso" />
  <div className="study-character-slot__arm study-character-slot__arm--back" />
  <div className="study-character-slot__arm study-character-slot__arm--writing" />
  <div className="study-character-slot__hand" />
  <div className="study-character-slot__pencil" />
</div>
```

占位造型要求：

- 使用侧后方或三分之二侧面剪影，减少对五官细节的依赖。
- 深棕发型使用一个完整大形，不用很多碎发片。
- 脸只保留非常弱的侧面轮廓，不画动漫大眼。
- 躯干使用灰绿色大色块。
- 内搭使用米白色小面积色块。
- 右臂自然落向笔记本，笔尖必须接近页面。
- 左臂或左手压住书页。
- 椅背只露出少量，不抢主体。
- 不画鞋、腿和复杂衣褶；桌面会遮住下半身。
- 不使用厚黑描边。
- 不使用强阴影、高光或塑料渐变。
- 不追求最终插画精度，只保证轮廓协调、透视合理、颜色统一。

禁止的占位方式：

- 单独一个正圆形头部。
- 一个矩形身体。
- 两根左右对称的胶囊手臂。
- 人物正对镜头僵直坐立。
- 夸张微笑、腮红和大眼。
- 将人物做成独立漂浮贴纸。
- 用“人物图片待替换”等文字代替人物。

占位尺寸与未来资产契约：

- 1440 × 900 页面下可视高度约 360 至 420px。
- 视觉容器使用固定 `aspect-ratio`，建议 `4 / 5`。
- 人物中心位于主场景横向 52% 至 58%。
- 底部锚定桌面，不随窗口宽度漂移。
- 容器内预留顶部 8%、左右各 6% 的透明安全区。
- 使用 `object-fit: contain` 等价布局，未来替换 `<img>`、Rive 或 Lottie 时不改变外层尺寸。
- 外层负责位置和裁切，内部占位视觉负责绘制。

未来替换接口应保持简单：

```tsx
function StudyCharacter({ mode = 'placeholder' }: { mode?: 'placeholder' | 'image' | 'rive' }) {
  return (
    <div className="study-character-frame" data-visual-slot="study-character">
      {mode === 'placeholder' ? <StudyCharacterPlaceholder /> : null}
      {/* 后续仅在这里替换正式角色渲染器 */}
    </div>
  );
}
```

当前只实现 `placeholder`，不要提前接入图片、Rive 或 Lottie。

人物占位轻动画：

- 整体 4.8 秒上下移动 1px，表示呼吸。
- 写字手 2.6 秒旋转约 1deg。
- 不做复杂停笔逻辑。
- 不眨眼。
- reduced motion 下完全停止。

未来正式角色资产建议规格只记录为注释或开发文档，不在本次生成：

```text
透明 PNG / WebP：建议 900 × 1100px，透明背景，完整上半身与双手；
Rive / Lottie：idle、writing、pause 三个状态；
安全区：顶部 8%，左右各 6%，底部与桌面锚点固定。
```

## 16. 木色桌面

桌面贯穿主场景下半部分，是空间结构，不是圆角卡片。

- 桌板位于主场景高度 65% 至 68%。
- 桌板厚度 24 至 30px。
- 桌前挡板高度约 110 至 140px。
- 主色 `--home-wood`。
- 桌板下缘使用 `--home-wood-mid`。
- 桌腿或暗部使用 `--home-wood-dark`。
- 木纹只画 2 至 4 条低对比度长曲线。
- 不使用规则垂直网格模拟木纹。
- 桌面顶面有非常轻的窗光反射，opacity 不超过 0.10。

桌面左右不得做 40px 以上圆角。只允许最外侧边缘有 4px 至 8px 轻微圆角。

## 17. 桌面小物

物件必须共享同一插画语言、描边宽度、透视和光源。

### 台灯

- 位于主场景左侧 8% 至 15%。
- 高度约人物高度的 38% 至 44%。
- 灯罩使用灰绿或柔黄，不用饱和橙色。
- 灯杆偏深绿或黄铜灰。
- 光晕只落在笔记本附近，范围约 180 × 120px。
- 光晕使用低透明径向渐变，opacity 不超过 0.16。

### 书本

- 两到三本即可。
- 宽度 84 至 120px。
- 颜色分别用灰蓝、低饱和珊瑚和纸白。
- 不画可读的小书名。
- 叠放角度不超过 2deg。

### 咖啡杯

- 48 至 56px 宽。
- 陶瓷纸白或浅灰绿。
- 把手不能比杯身大。
- 只放一到两条蒸汽线。
- 蒸汽周期约 3.2 秒，向上移动不超过 8px。

### 盆栽

- 放在人物右后侧或窗边。
- 花盆高度 34 至 42px。
- 三到五片叶子。
- 叶子颜色使用两种相近绿，不做一片叶一个颜色。
- 总高度不能超过人物头部的 60%。

### 笔记本与铅笔

- 笔记本应位于人物手下，是学习行为的焦点。
- 页面使用纸白。
- 中缝和书写线使用低对比灰绿。
- 铅笔使用柔黄与木色，不画成鲜黄色玩具。
- 人物的笔尖必须触到页面，不得悬空。

### hover

- 只有明确可互动的对象有 hover。
- 位移最大 `translateY(-2px)`。
- 旋转最大 1deg。
- 过渡 160 至 180ms ease-out。
- 台灯、书和杯子如果没有操作，就不需要 hover。

## 18. 纯 CSS 小绿团

小宠物必须使用 HTML + CSS 实现，不使用图片、远程资源、Lottie 或 Rive。未来可以替换，但当前 Demo 保持纯代码。

组件建议：

```tsx
<button
  className="green-companion"
  data-mood={mood}
  data-animation={animation}
  aria-label="和小绿团打招呼"
  type="button"
>
  <span className="green-companion__sprout" />
  <span className="green-companion__body">
    <span className="green-companion__eye green-companion__eye--left" />
    <span className="green-companion__eye green-companion__eye--right" />
    <span className="green-companion__mouth" />
    <span className="green-companion__blush green-companion__blush--left" />
    <span className="green-companion__blush green-companion__blush--right" />
  </span>
  <span className="green-companion__shadow" />
  <span className="green-companion__bubble" role="status" />
</button>
```

尺寸：

- 可视身体 84 × 72px。
- 完整按钮点击区至少 100 × 100px。
- 放在桌面右侧，不挡住人物的手和笔记本。

身体：

- 主色 `#78a67c`。
- 底部深色 `#628c68`。
- 使用不完全对称的软圆轮廓。
- 推荐 border-radius：`48% 52% 46% 44% / 56% 58% 42% 44%`。
- 顶部高光非常弱，不能有塑料胶质感。
- 身体下方放 36 × 8px、opacity 0.12 的椭圆阴影。

五官：

- 眼睛 5 × 8px。
- 眼睛颜色 `--home-text`。
- 两眼中心间距约 22px。
- 嘴巴宽 12px，线宽 1.5px。
- 腮红 11 × 5px，使用 `--home-coral`，opacity 0.28。
- idle 表情平静，不一直露出大笑。

小芽：

- 茎高 18px，宽 3px。
- 两片叶子约 13 × 8px。
- 左右角度不完全对称。
- 随呼吸摆动不超过 3deg。

呼吸：

- 周期 3.8 秒。
- 最大上移 2px。
- 纵向 scale 最大 1.018。
- 横向 scale 最小 0.992。
- 阴影与身体反向变化。
- 不要上下漂浮 8px。

眨眼：

- 周期 6.4 秒。
- 47% 开始闭眼，49% 恢复。
- 只压缩眼睛高度，不改变身体。
- reduced motion 下停止。

点击动画：

```text
0–120ms     向下压，scale(1.06, 0.92)
120–280ms   向上弹 5px，scale(0.97, 1.05)
280–460ms   回到初始状态
```

- 点击后切换开心嘴型。
- 开心状态持续 1100ms。
- 连续点击必须清理旧 timeout。
- 不创建多个重叠气泡。

气泡：

- 点击后出现，hover 不自动出现。
- 宽 168 至 188px。
- padding 10px 12px。
- 圆角 10px。
- 背景 `--home-surface`。
- 1px 边框。
- 使用 `--home-shadow-soft`。
- 进入 180ms，停留 1800ms，退出 160ms。
- 气泡不能盖住右侧主时钟。

台词循环：

```text
来了。今天想做点什么？
先挑一件小事就好。
我在旁边待着。
写一行，也算开始。
累了就慢一点。
先喝口水吧。
这段做完再歇一会儿。
```

状态：

```ts
type PetMood = 'idle' | 'greet' | 'happy' | 'concerned';
type PetAnimation = 'idle' | 'pop' | 'cheer';
```

保留 `data-mood` 和 `data-animation`，未来接入 Rive/Lottie 时只替换视觉层，不更改按钮、气泡和状态接口。

## 19. 右侧时钟与专注区

右侧结构继续保留，它是主页面的重要组成，不要删除或挪到底部。

容器：

- 宽 300px。
- 与左侧场景等高。
- 背景 `--home-surface`。
- 边框 1px `--home-border`。
- 圆角 12px。
- 阴影 `--home-shadow-soft`。
- padding 22px。
- 使用纵向布局，不塞满卡片。

从上到下：

```text
叶片图标 + NativeMind
心流小筑
本地时间 21:08
8月3日 · 夜晚
分隔线
圆形番茄计时器 25:00
当前任务：线性代数 · 第三章
开始专注按钮
今日摘要：2 段 · 50 分钟
```

品牌区域：

- 叶片图标 18px。
- `NativeMind` 12px muted。
- “心流小筑”22px、650。
- 不使用 48px 大标题。
- 不写营销文案。

本地时间：

- `21:08` 为 32px。
- 日期和天空阶段 12px muted。
- 本地时间每分钟更新。

番茄计时器：

- 直径 188 至 204px。
- 在右侧面板水平居中。
- 轨道宽 6px。
- 底轨使用 `--home-green-soft`。
- 进度使用 `--home-green`。
- 中间 `25:00` 为 54px。
- 下方小字“下一段”。
- 不使用彩虹 conic-gradient。
- idle 时只做 5 秒一次、scale 0.995 到 1.005 的呼吸感。
- 不持续旋转。

当前任务：

- 13px、单行省略。
- 左侧可有 `BookOpen` 图标。
- 不再套一张任务卡。

主按钮：

- 宽 100%。
- 高 42px。
- 圆角 10px。
- 低饱和实心绿。
- 图标 `Play` + 文案“开始专注”。
- 它是首屏唯一实心主按钮。

今日摘要：

- 12px muted。
- 放在底部。
- 示例“今天 2 段 · 50 分钟”。
- 不放三枚 lo-fi、白天、25 分钟的胶囊标签。
- 不显示“当前只是视觉 Demo”的说明文字。

## 20. 底部功能 Dock

继续固定在页面底部中央。

尺寸：

- 总宽 520 至 560px。
- 高 66px。
- bottom 18px。
- padding 6px 8px。
- 圆角 16px。
- 背景 `rgba(251, 250, 246, 0.95)`。
- 1px 边框。
- 阴影 `--home-shadow-float`。
- backdrop blur 最多 8px，也可以不用。

六个入口等宽：

| key | 文案 | 图标 |
|---|---|---|
| today | 今天 | ListTodo |
| focus | 专注 | Timer |
| knowledge | 知识 | LibraryBig |
| review | 复盘 | ChartNoAxesColumnIncreasing |
| companion | 陪伴 | Sprout |
| settings | 设置 | Settings2 |

单项：

- 宽约 80 至 88px。
- 高 52px。
- 上方 20px 图标。
- 下方 11px 标签。
- 不显示第二行 hint。
- 背景默认透明。
- 圆角 10px。

状态：

- hover：浅绿背景，图标上移 1px。
- active：浅绿背景 + 深绿图标和文字 + 底部 2px 状态线。
- pressed：scale 0.97，90ms。
- 不让整个 Dock 按钮上浮 7px。
- 每项使用 `aria-pressed`。
- 再点击 active 项关闭面板。

不要为每个 Dock 图标画一个不同颜色的渐变方块。图标风格必须统一。

## 21. lo-fi 音乐条

继续固定在右下角，不改变位置关系。

尺寸：

- 宽 228 至 248px。
- 高 48px。
- right 20px。
- bottom 20px。
- 与 Dock 之间至少 24px 间距。
- 背景 `rgba(41, 51, 47, 0.94)`。
- 圆角 10px。
- 1px 低透明浅色边框。
- 阴影比 Dock 更轻。

内部：

- 左侧 32 × 32px 圆形播放/暂停按钮。
- 使用 Lucide `Play` / `Pause`。
- 中间曲名“Quiet Window”。
- 小字“lo-fi · 低音量”。
- 右侧五根均衡器。

均衡器：

- 每根宽 2px。
- 高度范围 6 至 16px。
- 间距 3px。
- 颜色为柔和浅绿。
- 播放时 800 至 1100ms 不同相位变化。
- 暂停时停止动画并保持 6px。

点击只切换本地视觉状态，不播放真实音乐，不 import `music-store` 或 `audioPlayer`。

## 22. 副面板通用结构

副面板继续从底部滑出，不改成路由页或居中 Modal。

桌面尺寸：

- 宽 `min(1040px, calc(100vw - 64px))`。
- 高度根据内容，最大 `min(66dvh, 610px)`。
- 底部距 Dock 顶部至少 16px。
- 背景 `--home-surface`。
- 顶部圆角 16px。
- 边框 1px。
- 阴影 `--home-shadow-panel`。
- padding 22px 24px 24px。
- overflow auto。

遮罩：

- `rgba(30, 38, 34, 0.22)`。
- 可有 2px blur。
- 不能把背景完全变黑或完全模糊。

Header：

- 左侧标题和一句副标题。
- 标题 22px。
- 副标题 12px muted。
- 右侧 40 × 40px `X` 图标按钮。
- 不直接使用文本字符 `×`。
- 不显示 `Demo panel`。

打开动画：

- 240ms。
- `cubic-bezier(.2,.8,.2,1)`。
- translateY 从 26px 到 0。
- opacity 从 0 到 1。
- 不缩放面板，避免文字模糊。

关闭：

- `Esc`。
- 遮罩。
- X 按钮。
- 再点 active Dock。

焦点：

- 打开后焦点进入面板。
- 关闭后焦点回到触发 Dock 项。
- 使用 `role="dialog"`。
- 使用 `aria-modal="true"`。
- 使用 `aria-labelledby`。
- 背景不能在面板打开时继续接受点击。

内部结构：

- 不做卡片套卡片。
- 使用分栏、列表、分隔线和表单分组。
- 重复的笔记结果可以使用独立卡片。
- 普通设置项使用列表行，不为每一个设置项加一个卡片。

## 23. “今天”面板

标题：“今天”。

副标题：“把要做的事放轻一点。”

两栏布局：

- 左栏 60%。
- 右栏 40%。
- 间距 28px。
- 中间可以使用一条 1px 竖分隔线。

左栏顶部：

- 输入框 placeholder：“今天想推进什么？”
- 左侧 `Plus` 或 `PencilLine` 图标。
- 右侧一个 38 × 38px 圆形 Plus 按钮。
- 按 Enter 或点击按钮可把内容临时加入本地数组。
- 空文本不添加。
- 不调用真实 Todo store。

任务组：

```text
线性代数 · 第三章                         2 / 4
□ 整理特征值定义                          20 min
□ 做三道例题                              35 min
■ 标出卡住的步骤                          10 min
□ 写一张复习卡                            15 min
```

- 每行高 42px。
- 使用底部分隔线，不把每一行放进卡片。
- checkbox 18px。
- 选中状态浅绿底 + Check 图标。
- 任务文本 14px。
- 时间 12px muted，右对齐。
- 已完成行 opacity 0.62，不使用粗删除线。

右栏“今天的节律”：

- 使用横向或纵向时间轴，不使用三根纯占位进度条。
- 时间点：09:00、11:00、14:30、19:00。
- 三种标记：任务、专注、休息。
- 使用灰蓝、绿色、珊瑚三种低饱和色。
- 底部文案：“预计 3 段专注 · 75 分钟”。

## 24. “专注”面板

标题：“专注”。

idle 副标题：“先选一段舒服的时长。”

active 副标题：“这一段只做眼前的事。”

本地状态：

```ts
type FocusVisualState = 'idle' | 'active' | 'paused' | 'elapsed';
```

### idle

- 左侧 200px 计时环。
- 中间 `25:00`。
- 右侧设置区。
- 时长 segmented control：15 / 25 / 45 / 60。
- 任务选择：“线性代数 · 第三章”。
- 环境音：雨声、咖啡馆、安静。
- 主按钮：“开始专注”。

### active

- 隐藏时长、任务和环境音选择。
- 计时环居中放大到 224px。
- 下方输入：“这段做了什么”。
- secondary 按钮：“暂停”。
- ghost 按钮：“放弃”。
- 不显示统计图、排行榜和成就。

### paused

- 计时数字保持。
- 进度环停止呼吸。
- 主按钮：“继续”。
- 次按钮：“结束这段”。

### elapsed

- 文案：“时间到了，慢慢收个尾。”
- 主按钮：“完成这段”。
- 次按钮：“再留 5 分钟”。
- 不自动判定完成。
- 不放烟花或彩纸。
- 不写入真实 history。

## 25. “知识”面板

标题：“知识”。

副标题：“从自己的笔记里找答案。”

顶部搜索：

- 搜索框占宽度约 76%。
- 左侧 Search 图标。
- placeholder：“搜索笔记、概念或问题”。
- 右侧圆形 ArrowRight 图标按钮。
- 输入只改变本地 state。

最近搜索 chips：

```text
特征向量
线性变换
RAG
昨日笔记
```

结果区只放两张笔记卡：

```text
特征向量与基底
线性变换作用后方向保持不变的向量。换基底会改变坐标表达，
但不改变这个几何关系。
线性代数/第三章 · 昨天 21:40
```

```text
相似矩阵为什么有相同特征值
它们描述的是同一个线性变换在不同基底下的矩阵表达。
线性代数/随手记 · 8月1日
```

卡片要求：

- 两列等宽。
- 圆角 10px。
- 边框 1px。
- 无强阴影。
- 标题 15px。
- 摘要最多三行。
- 来源 12px muted。
- 不放“AI 已生成”等虚假状态。

## 26. “复盘”面板

标题：“复盘”。

副标题：“看看发生了什么，不急着评价。”

顶部 segmented control：日 / 周 / 月。

- 三项放在一个整体控件中。
- 当前项为浅绿底。
- 不使用三枚独立胶囊按钮。

主体两栏：

- 左侧 58%：“今天发生了什么”。
- 右侧 42%：“留给下一次”。

左侧内容：

```text
完成 3 项
专注 50 分钟
在“相似矩阵”处停了 12 分钟
晚上更适合整理，不适合继续开新章节
```

每一行使用简洁图标和文字，不做四张统计卡。

右侧：

```text
先把相似矩阵的定义写成自己的话，再做例题。
```

底部 secondary 按钮：“整理成复习卡”。点击后只显示本地视觉反馈，不调用模型。

## 27. “陪伴”面板

标题：“陪伴”。

副标题：“它会安静地待在旁边。”

左栏：

- 放大版小绿团，身体约 132 × 116px。
- 复用同一个 `GreenCompanion` 组件。
- 不复制另一套宠物 CSS。
- 三个互动按钮：打招呼、歇一会儿、准备专注。
- 使用 icon + text 的 secondary 按钮。

右栏“最近说过”：

- 只显示最近 4 条。
- 时间小字如“21:06”。
- 宠物和用户内容左右轻微错开。
- 不添加头像。
- 不做完整聊天界面。
- 不加自由输入框。
- 不加发送按钮。

文案要求：

- 每条不超过 30 个汉字。
- 不使用感叹号。
- 不写“太棒了”“你一定可以”。
- 不过度卖萌。

## 28. “设置”面板

标题：“设置”。

副标题：“把环境调成适合你的样子。”

使用三组设置列表，每组之间 1px 分隔线，不做三张卡片。

### 场景

- 跟随本地时间：toggle，默认开。
- 显示窗外动画：toggle，默认开。
- 场景亮度：slider，默认 80%。
- 纯色背景：toggle，默认关。

### 安静模式

- 专注中不主动提醒：toggle，默认开。
- 结束提示音：toggle，默认开。
- 外部搜索前确认：toggle，默认开。

### 模型展示

- 快速模型：只读输入 `qwen2.5:1.5b`。
- 教练模型：只读输入 `qwen2.5:7b`。
- 不调用 `model_list` 或 `model_is_ready`。
- 不显示虚假绿色在线标记。

toggle 必须绘制成正式 switch，不能使用裸 checkbox。slider 和 switch 需要支持键盘操作。

## 29. 图标系统

优先使用 `lucide-react`，不要继续手工画一套风格不一致的 CSS 渐变图标。

规则：

- 默认图标 18px。
- Dock 图标 20px。
- stroke width 1.75 或 2。
- 图标颜色继承文字色。
- 不给每个图标添加彩色方形底板。
- 不混用 emoji、Unicode 符号和 Lucide。
- 熟悉命令使用图标：关闭、播放、暂停、增加、音量。
- 陌生图标按钮需要 tooltip。
- 有文字标签的 Dock 不重复显示 tooltip。

## 30. 动画规范

动画目的只有三个：

1. 表现时间和环境在缓慢变化。
2. 让人物与宠物有轻微生命感。
3. 对点击、打开和关闭提供反馈。

持续动画最多同时存在：

- 云层。
- 星星，仅夜晚。
- 女孩写字。
- 宠物呼吸。
- 咖啡蒸汽。
- 音乐均衡器，仅播放时。

飞鸟采用长周期偶尔经过，不在原地持续摆动。

性能：

- 持续动画只改变 transform 和 opacity。
- 不动画 width、height、top、left、filter blur 或 box-shadow。
- 不用 requestAnimationFrame 做装饰动画。
- 不为星星创建 React 高频状态。
- 不开启 canvas 每帧绘制。
- `will-change` 只放在少量持续运动元素上。

必须支持：

```css
@media (prefers-reduced-motion: reduce) {
  /* 停止云、鸟、星星、呼吸、写字、蒸汽和均衡器 */
}
```

reduced motion 下仍要保留面板立即打开和状态切换，不影响功能可用性。

## 31. 鼠标与键盘体验

这是桌面应用，必须认真设计鼠标和键盘反馈。

- 所有按钮 hover 状态清晰但克制。
- 按钮 pressed 使用 scale 0.97 至 0.99。
- focus-visible 使用 2px `--home-green` outline，offset 2px。
- 不要移除默认焦点后不给替代。
- Dock 可通过 Tab 依次聚焦。
- Enter / Space 可打开面板。
- Esc 关闭副面板。
- 面板关闭后焦点返回触发项。
- tooltip 延迟 450 至 600ms 出现，避免鼠标经过时到处弹。
- 纯装饰物件不得拥有手型 cursor。

## 32. 可访问性

- 根节点使用 `<main>`。
- 左侧房间使用有意义的 `<section>` 或 `aria-label`。
- Dock 使用 `<nav aria-label="功能入口">`。
- 音乐条使用 `<aside aria-label="lo-fi 音乐">`。
- 宠物必须是 `<button type="button">`。
- 图标按钮有 `aria-label`。
- 气泡使用 `role="status"`，但不要重复频繁朗读。
- 副面板使用 `role="dialog"` 和 `aria-modal="true"`。
- 输入框有 label，可使用 `.sr-only`。
- active 状态不能只靠颜色，需要状态线、粗细或 `aria-pressed`。
- 正文对比度达到 WCAG AA。
- 所有中文文字不能被裁切。
- 计时数字使用 tabular numbers，状态切换时布局不跳动。

## 33. 推荐文件结构

可以在不破坏真实应用的前提下重构 Demo：

```text
src/ui/demo/cozy-home/
├── CozyHomeDemo.tsx
├── cozy-home-demo.css
├── types.ts
├── visual-slots.ts
├── components/
│   ├── AmbientStudyRoom.tsx
│   ├── WindowScene.tsx
│   ├── StudyCharacter.tsx
│   ├── StudyCharacterPlaceholder.tsx
│   ├── DeskProps.tsx
│   ├── GreenCompanion.tsx
│   ├── SideFocusClock.tsx
│   ├── FeatureDock.tsx
│   ├── LofiPlayer.tsx
│   └── DemoPanel.tsx
└── panels/
    ├── TodayPanel.tsx
    ├── FocusPanel.tsx
    ├── KnowledgePanel.tsx
    ├── ReviewPanel.tsx
    ├── CompanionPanel.tsx
    └── SettingsPanel.tsx
```

如果当前项目希望维持较少文件，可以合并小组件，但至少保证：

- 主场景独立。
- 背景、人物、宠物和音乐封面有明确 `data-visual-slot`。
- 小宠物独立且可复用。
- 右侧时钟独立。
- Dock 独立。
- 副面板容器独立。
- 六个面板不全部堆在主组件里。

CSS 可使用一个文件，但必须分段清晰：Tokens、Layout、Scene、Girl、Pet、Clock、Dock、Lofi、Panel、Motion、Desktop window adjustments。

## 34. Demo 本地状态

建议类型：

```ts
type PanelKey =
  | 'today'
  | 'focus'
  | 'knowledge'
  | 'review'
  | 'companion'
  | 'settings';

type SkyPhase = 'day' | 'dusk' | 'night';
type FocusVisualState = 'idle' | 'active' | 'paused' | 'elapsed';
type PetMood = 'idle' | 'greet' | 'happy' | 'concerned';
type PetAnimation = 'idle' | 'pop' | 'cheer';
```

状态：

```text
activePanel
skyPhase
focusVisualState
selectedMinutes
petMood
petAnimation
petLineIndex
lofiPlaying
demoTasks
demoSettings
```

全部保存在页面或组件局部 state 中，不创建 Zustand store，不做 localStorage 持久化。

## 35. 页面入口

- 保留 `src/ui/App.tsx`。
- 当前 `src/main.tsx` 如果已经临时渲染 `<CozyHomeDemo />`，可以继续使用。
- 确保恢复真实应用只需要改回一处 import 和 `<App />`。
- 不引入路由库。
- 不修改 Tauri 配置。
- 不修改 Rust。

## 36. 需要彻底移除的现版问题

完成前逐项检查：

- 移除巨大 28px 至 32px 圆角。
- 移除页面背景中的装饰性径向光斑。
- 移除彩虹式 conic-gradient 时钟环。
- 移除 Dock 的第二行 hint。
- 移除每个 Dock 项不同颜色的手工渐变图标。
- 移除“Demo panel”英文眉题。
- 移除页面上的 Demo 说明文案。
- 移除时钟下方“白天 / 25 分钟 / lo-fi”三枚胶囊。
- 移除所有桌面物件统一上浮 7px 的 hover。
- 移除几何圆头、矩形身体、胶囊手臂式女孩。
- 移除副面板内部过多卡片。
- 移除大面积黄米色主导。
- 移除强玻璃拟态和过量 backdrop blur。
- 移除多层阴影和假发光。
- 移除纯装饰对象的 pointer cursor。

## 37. 实施步骤

按顺序完成：

1. 阅读现有代码和五个本地 skill。
2. 用不超过 10 行总结现版视觉问题。
3. 确认不改变当前页面结构和真实应用边界。
4. 建立统一 Token 和桌面布局尺寸。
5. 使用 CSS 色块重建房间、窗户、天空、桌面和小物占位层。
6. 制作简洁的 CSS 人物剪影占位，不生成或下载正式资产。
7. 校准人物插槽与桌面、窗户的比例和遮挡关系。
8. 重做纯 CSS 小绿团。
9. 重做右侧时钟和番茄钟。
10. 重做 Dock 和音乐条。
11. 重做副面板通用容器。
12. 重做六个副面板内容。
13. 添加低频动画。
14. 检查 1920、1600、1440、1366、1280 五种桌面尺寸。
15. 检查键盘、Esc、焦点返回和 reduced motion。
16. 最后再运行类型检查和构建。

不要一开始先堆动画。静态构图必须先达到视觉要求。

## 38. 桌面尺寸验收

每个尺寸都检查：

### 1920 × 1080

- 场景不会被无限拉宽。
- 人物不会变得过大。
- 右侧时钟保持约 300px。
- 主要内容集中，留白均衡。

### 1600 × 900

- 主场景和右侧时钟比例自然。
- Dock 和音乐条间距充足。
- 副面板不超过 1040px。

### 1440 × 900

- 作为主视觉基准。
- 小女孩是首屏第一视觉焦点。
- 右侧时钟清晰但不压过主场景。
- 桌面小物不拥挤。

### 1366 × 768

- 窗户、小女孩、桌面完整。
- 右侧内容不发生纵向溢出。
- Dock 不挡住桌面主要区域。
- 音乐条不和 Dock 重叠。

### 1280 × 720

- 不出现页面纵向滚动条。
- 右侧面板仍能完整显示主按钮。
- 可适当减少墙面留白或缩小人物 8% 至 12%。
- 可以隐藏最不重要的墙饰，但不能隐藏人物、宠物、主时钟或 Dock。

## 39. 交互验收

- 本地时间正确显示并每分钟更新。
- day / dusk / night 阶段切换逻辑正确。
- 六个 Dock 项分别打开对应面板。
- 再点 active Dock 可以关闭。
- Esc 可以关闭。
- 点击遮罩可以关闭。
- X 图标可以关闭。
- 关闭后焦点回到触发 Dock 项。
- 小绿团点击后弹跳一次、切换开心表情、显示轮换气泡。
- 连续点击不会堆叠 timeout。
- 气泡不会挡住时钟或超出场景。
- 音乐条能切换播放和暂停视觉状态。
- 今天面板可以本地添加临时任务。
- 专注面板可以本地切换 idle / active / paused / elapsed。
- 设置开关只改变本地显示。
- 所有真实数据库、模型、音频和 Tauri 功能均未调用。

## 40. 视觉验收

- 第一眼能明确看到小女孩正在写作业。
- 女孩占位能够清楚表达侧身写作业，不像正圆头的玩具娃娃。
- 人物插槽、手臂占位、笔和笔记本关系基本自然，足以验证未来资产尺寸。
- 人物和桌面不漂浮。
- 窗外时间阶段明显但不抢主体。
- 颜色不发黄、不一片绿色、不高饱和。
- 房间、人物和小物采用同一种插画语言。
- 右侧时钟不再像巨大彩虹圆盘。
- Dock 紧凑、统一、像桌面工具条。
- 音乐条安静，不抢主操作。
- 小宠物可爱但不幼稚。
- 副面板内容有结构，不是卡片堆砌。
- 页面不存在可见的技术说明和 Demo 说明。
- 中文无乱码、无裁切、无重叠。
- 任何动态内容都不会造成布局跳动。

## 41. 代码验收

完成后运行：

```text
npm run typecheck
npm run build
```

搜索并确认新 Demo 没有 import 或调用：

```text
@tauri-apps/api
invoke
src/ui/stores/runtime
useTodoStore
useFocusStore
useNoteStore
useCompanionStore
createTauriRuntime
TauriSqlDriver
TauriModelProvider
modelRouter
repository
```

如果检查失败，只修本次 Demo 引入的问题，不顺手重构真实应用。

## 42. 最终交付说明

完成后只汇报：

1. 主场景、人物、右侧时钟、Dock、宠物和副面板分别重设计了什么。
2. 修改和新增的文件。
3. 背景、人物、图标、宠物和动画分别预留了哪些未来资产插槽。
4. 哪些交互是 React 本地 Demo。
5. 明确说明没有接数据库、模型、真实音频或 Tauri。
6. 类型检查和生产构建结果。
7. 五个桌面 viewport 的截图检查结果。

不要宣称已经完成真实业务接入。不要只以“编译通过”作为视觉完成标准，必须以五个桌面尺寸的实际画面为最终判断。

## 提示词正文结束

---
