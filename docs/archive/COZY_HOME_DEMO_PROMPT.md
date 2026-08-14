# NativeMind 心流小筑主页面 Demo 超详细提示词

这份提示词用于让 AI 编码助手在 NativeMind 项目里制作一个**纯展示、不接业务功能**的主页面 Demo。目标是验证视觉方向：简洁、可爱、适合番茄钟与学习陪伴，类似“心流小筑 / lo-fi 学习房间”的氛围。

## 角色

你是 NativeMind 的资深前端与产品视觉工程师。你需要在现有 Tauri + React + TypeScript 项目里做一个可运行的 UI Demo。这个 Demo 只展示未来主页面方向，不读取数据库、不调用应用用例、不连接模型、不写入任何用户数据。

你的重点不是堆功能，而是建立一个“用户愿意待一整天”的学习空间：安静、有呼吸感、柔和、可爱但不幼稚。

## 当前项目架构判断

NativeMind 已经有完整分层：

```text
src/ui
  React 页面、组件、Zustand store、确认弹窗、导航

src/application
  用例、事件总线、策略、确认服务、端口定义

src/ai
  ModelRouter、prompt/schema、RAG、搜索门禁、陪伴生成

src/infrastructure
  SQLite repository、Tauri driver、Tauri model provider、文件导入、向量库、音乐、后台任务

src-tauri
  Rust command：SQLite、文件、模型、向量、音频、路径与备份
```

生产路径大致是：

```text
UI store
  -> application use-case
  -> repository / AI port / infrastructure port
  -> createTauriRuntime
  -> TauriSqlDriver / TauriModelProvider
  -> Rust command
  -> SQLite / Ollama / 文件系统
```

浏览器预览路径是：

```text
UI store
  -> createLocalDemoRuntime
  -> 内存仓储 + 模板 AI
```

本次 Demo 必须绕开以上运行时。不要 import：

- `src/ui/stores/runtime`
- `useCases`
- `repositories`
- `infrastructure`
- `eventBus`
- `@tauri-apps/api`
- 任何真实后端命令

允许使用：

- React 本地 `useState` / `useEffect`
- 纯 CSS 动画
- 静态示例文本
- 独立 CSS 文件

## 必须参考的项目 Skill

读取并遵守这些本地 Skill：

```text
.claude/skills/nativemind-cozy-ui/SKILL.md
.claude/skills/nativemind-pomodoro-flow-ui/SKILL.md
.claude/skills/nativemind-companion-widget/SKILL.md
.claude/skills/nativemind-ambient-scene/SKILL.md
.claude/skills/nativemind-tauri-ui-contract/SKILL.md
```

本次实际使用重点：

- `nativemind-cozy-ui`：整体简洁、可爱、成人可用、非营销、非冷后台。
- `nativemind-pomodoro-flow-ui`：专注低打扰，计时器呼吸感，结束不强制打断。
- `nativemind-companion-widget`：纯代码小宠物，短句、不打鸡血、可替换 Lottie/Rive。
- `nativemind-ambient-scene`：lo-fi 学习房间、窗外天景、桌面小物、音乐条。
- `nativemind-tauri-ui-contract`：这次不对接 Tauri，但不能改命令契约、不能破坏真实运行时文件。

## 交付物

实现一个新的展示组件：

```text
src/ui/demo/CozyHomeDemo.tsx
src/ui/demo/cozy-home-demo.css
```

入口可以临时切到：

```text
src/main.tsx -> <CozyHomeDemo />
```

但不要删除原来的真实应用入口组件 `src/ui/App.tsx`，方便之后切回。

## 总体页面目标

首屏是一个完整主场景：

```text
左侧/中心：lo-fi 学习房间
  - 大窗户
  - 窗外天空随本地时间变化
  - 小女孩安静写作业
  - 木色桌面
  - 桌面小物：台灯、咖啡杯、盆栽、书、桌面小钟
  - 纯 CSS 小宠物

右侧：本地时钟卡片
  - 当前时间
  - 日期
  - 当前天空阶段
  - “视觉 Demo，不接真实数据”提示

底部：功能 Dock
  - 今天
  - 专注
  - 知识
  - 复盘
  - 陪伴
  - 设置

右下角：lo-fi 音乐条
  - 播放按钮视觉
  - 曲名
  - 跳动均衡器
```

## 主场景细节

### 1. 窗外天景

根据本地时间计算天空阶段：

```ts
if hour >= 6 && hour < 16 -> day
if hour >= 16 && hour < 19 -> dusk
else -> night
```

视觉要求：

- 白天：浅蓝天空、柔和云、远山、飞鸟。
- 黄昏：橘红到紫灰渐变，太阳较低。
- 夜晚：深蓝天空、月亮、星星闪烁。
- 山丘分两层：远山低透明、近山更深。
- 飞鸟不要太多，轻微漂浮即可。
- 动画全部 CSS keyframes，不要每帧 JS。

### 2. 房间与桌面

房间：

- 暖底色。
- 有轻微网格/墙面纹理，但不能抢文字可读性。
- 圆角大容器，像一个小房间窗口。

桌面：

- 木色桌面，占画面下半部。
- 有柔和阴影。
- 桌面小物 hover 微微抬起：

```css
.desk-prop:hover {
  transform: translateY(-6px);
}
```

小物：

- 台灯：灯罩、灯柱、底座、柔光。
- 咖啡杯：杯体、把手、热气。
- 盆栽：花盆、叶子。
- 书：三本叠放。
- 小钟：显示 `10:09` 作为静态装饰。

### 3. 小女孩写作业

必须纯 CSS/HTML 实现，不用图片。

构成：

- 后发层。
- 脸部。
- 刘海。
- 眼睛闭合或低头状态。
- 腮红。
- 身体。
- 两只手臂。
- 桌上的本子。
- 铅笔。

动画：

- 轻微呼吸上下动。
- 不要大幅动作。
- 不要卡通夸张。

## CSS 小宠物

实现一个纯代码“小绿团”：

视觉：

- 圆润绿色团子。
- 两只眼睛。
- 小嘴。
- 腮红。
- 头顶小芽。
- 底部软阴影。

动画：

- 常态轻轻上下浮动。
- 定时眨眼。
- 点击时弹一下。
- 点击后表情开心，小嘴变成更明显的弧线。

交互：

- 点击宠物后循环显示短气泡。
- 气泡短句，不打鸡血，示例：

```text
来了。今天想做点什么？
先挑一件小事就好。
我在旁边待着。
写一行，也算开始。
累了就慢一点。
```

技术约束：

- 使用 React 本地 state。
- 不接 `companion-store`。
- 不写 DB。
- 不调用真实 AI。
- class 或 data attribute 需要为未来 Lottie/Rive 留接入余地。

未来接入说明：

```text
后续可以把 .cozy-pet 替换为 Rive/Lottie canvas：
- idle -> 呼吸待机
- greet -> 点按问候
- cheer -> 专注完成
- concerned -> 多次中断
保持气泡层与状态接口不变。
```

## 功能入口 Dock

Dock 固定在底部居中。

入口：

- 今天
- 专注
- 知识
- 复盘
- 陪伴
- 设置

每个按钮：

- 有一个 CSS 小图标，不使用外部图标库。
- 有主标签和小提示。
- hover 微抬。
- active 有浅绿色底。

点击后：

- 底部滑出圆角副面板。
- 面板不接真实功能。
- 面板可通过 Esc、遮罩、关闭按钮关闭。

## 副面板内容

### 今天

展示：

- “加一条”输入框。
- 添加按钮。
- 同组拆分任务列表。
- 今日节律进度条。

示例内容：

```text
线性代数第三章：特征值复习
整理定义与符号
做 3 道例题
写一句卡点
```

### 专注

展示：

- 会转的呼吸计时环。
- 中间 `25:00`。
- 环境音 chips：雨声、咖啡馆、安静。
- 备注线条占位。

文案：

```text
计时结束只提示收尾，不自动打断。
```

### 知识

展示：

- 搜索框。
- 搜索按钮。
- 最近搜索 chips。
- 笔记卡片。
- 待连接卡片。

示例：

```text
特征向量怎么和线性变换联系？
线性代数
RAG
昨日笔记
```

### 复盘

展示：

- 日/周/月按钮。
- 今日摘要卡。
- 下一步卡。

示例：

```text
完成 3 项 · 专注 50 分钟 · 一个卡点待回看。
把“特征值”整理成 3 张复习卡。
```

### 陪伴

展示：

- 小绿团互动区。
- 历史气泡。
- 不接真实 companion store。

### 设置

展示：

- 开关：专注中不打扰、外部搜索需确认。
- 双模型字段：

```text
快速模型 qwen2.5:1.5b
教练模型 qwen2.5:7b
```

## lo-fi 音乐条

固定右下角。

展示：

- 圆形播放按钮。
- 曲名：`Valley - Lolek`
- 小字：`从头播放 · 低音量`
- 跳动均衡器。

约束：

- 不播放真实音频。
- 不接 `music-store`。
- 只是视觉展示。

## 样式原则

- 尽量使用项目现有 CSS 变量作为基础：`--bg / --surface / --border / --text / --text-muted / --accent / --accent-soft`。
- Demo 可以在局部组件根节点定义局部变量，但颜色必须低饱和、暖、柔和。
- 不做营销大标题。
- 不做玻璃拟态过重的炫技。
- 可爱但给成人用。
- 文本不要挤，不要和图形重叠。
- 所有动画尊重：

```css
@media (prefers-reduced-motion: reduce)
```

## 可访问性

- 主区域使用 `<main>`。
- Dock 使用 `<nav aria-label="功能入口">`。
- 宠物是 `<button>`，有 `aria-label`。
- 副面板有关闭按钮和遮罩关闭。
- Esc 可以关闭面板。
- 输入框是 readOnly 或纯展示，避免用户误以为已经接真实功能。
- focus-visible 应该保持可见。

## 禁止事项

- 不要调用 Tauri。
- 不要 import `runtime.ts`。
- 不要调用 `useTodoStore`、`useFocusStore`、`useNoteStore` 等真实 store。
- 不要写入数据库。
- 不要调用模型。
- 不要安装新依赖。
- 不要引入外部图片。
- 不要改 Rust 后端。
- 不要改 `src-tauri` command 契约。
- 不要删除真实应用页面。

## 验证

完成后至少运行：

```bash
tsc
```

如果环境允许，再运行：

```bash
vite build
```

手动检查：

- 首屏能看到小女孩写作业。
- 宠物点击会弹气泡。
- Dock 点击能打开副面板。
- Esc / 遮罩 / 关闭按钮能关闭副面板。
- 夜晚时星星与月亮样式存在。
- 移动窄屏不发生严重重叠。

