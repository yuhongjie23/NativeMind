# Tech Debt Tracker

> Last updated: 2026-08-06

Tracking known technical debt, trade-offs, and cleanup items.

## Active Tech Debt

### TD-001: Permissive CSP
- **File**: `src-tauri/tauri.conf.json`
- **Issue**: CSP is set to `null`, disabling all content security
- **Risk**: XSS in production
- **Fix**: Define production CSP before release
- **Priority**: High (before v1.0)

### TD-002: No Database Encryption
- **File**: `src-tauri/src/db/`
- **Issue**: SQLite database is stored in plaintext
- **Risk**: Sensitive notes readable if device is compromised
- **Fix**: Integrate SQLCipher or filesystem-level encryption
- **Priority**: Medium

### TD-003: No Automatic Backup
- **File**: N/A (not yet implemented)
- **Issue**: Single point of failure — one corrupted db file = all data lost
- **Risk**: Data loss
- **Fix**: Periodic backup to a timestamped copy
- **Priority**: High (before v1.0)

### TD-004: PDF Parser Limited to Extract
- **File**: `src-tauri/src/file_parser/pdf.rs`
- **Issue**: `pdf-extract` crate extracts text by page but doesn't preserve structure
- **Risk**: Complex PDF layouts (tables, multi-column) lose formatting
- **Fix**: Evaluate `lopdf` or `pdf` crate for richer extraction
- **Priority**: Low

### TD-005: No Migration Rollback
- **File**: `src/infrastructure/db/migrations/`
- **Issue**: Forward-only migrations; no downgrade path
- **Risk**: Failed migration leaves DB in unknown state
- **Fix**: Add migration dry-run and rollback capability
- **Priority**: Medium

### TD-006: In-Memory Driver Not Feature-Complete
- **File**: `src/infrastructure/local-demo.ts`
- **Issue**: Some repository methods throw "not implemented" in web mode
- **Risk**: Can't fully test UI flows without desktop mode
- **Fix**: Complete all repository method implementations
- **Priority**: Low

### TD-007: Test Coverage Gaps
- **Issue**: Integration tests exist only for todo and knowledge-link repos
- **Missing**: Focus, review, companion, socratic integration tests
- **Fix**: Add integration tests for remaining repositories
- **Priority**: Medium

### TD-008: No E2E Test for Desktop
- **File**: `tests/e2e/`
- **Issue**: Only one E2E test scenario; runs in web mode only
- **Risk**: Desktop-specific bugs undetected until manual testing
- **Fix**: Add Tauri E2E tests (WebDriver-based)
- **Priority**: Low

## Resolved Tech Debt
- **优化批 O1–O6**（见 `docs/exec-plans/bug-review.md` 六）：复盘 N+1 → `findByDateRange` 一次区间查询；`withTimeout` 竞态清 timer；短块合并改判当前块；周/月复盘正文长度按 reviewType 参数化；音乐库读成功才互斥；light_summary 每批 4 条限并发。typecheck/lint/373 全绿。
- **AI 层 + 夏日背景音**（见 `docs/exec-plans/bug-review.md` 六）：coach 档死配置显式化（coach/deep 共用 big）；embed 管道注入 Tauri IPC provider（不再 WebView fetch 本机）；向量维度变化 DROP 后把笔记打回 stale 并启动重建（不静默丢向量）；**夏日背景音**：新增 `summer_firefly.mp3` 映射进 `backgroundMusicFor`，走同一路 ♪ 键控制。M16（迁移过吞错误）评估后**保持原状 by design**（有单测覆盖的恢复机制）。typecheck/lint/373 全绿。
- **Rust 稳定/安全批 + 体验批**（见 `docs/exec-plans/bug-review.md` 六）：db reopen 持锁原子替换（热切换不丢写）；db_backup 进 spawn_blocking；vec0.dll 每次启动从捆绑覆盖；ollama serve stdio null；SSRF 重定向跟随前校验；ensure_writable_within 拒 symlink；专注结束提示音接线 + 生成 `public/audio/cue/complete.wav`；苏格拉底 prompt 占位符修好；Self-RAG 流式 preview 加重置信号。typecheck/lint/373 全绿。**新发现**：内置音效库全空（见 bug-review 四补），除 complete.wav 外所有环境音/提示音都无声，待补音频。
- **中危批修复**（见 `docs/exec-plans/bug-review.md` 六）：确认门先 commit 后 confirmed；删笔记发 `NoteDeleted` 事件并入审计；AI 任务写入过确认门补审计（requiresConfirmation:false 不弹第二个框）；applyAmbient 补 sceneId/timePhase deps（修切场景全静音）；专注音乐自动播放重试监听卸载清理；音乐库 playAt 加请求序号防播错曲目。typecheck/lint/373 全绿。
- **高危 4 项修复**（见 `docs/exec-plans/bug-review.md` 六）：写信丢信件（write-letter 包 try/catch 落 pending）、file_write_text 禁写 DB/backups/extensions（canonical 段比较防 junction）、流式中文乱码（字节缓冲整行解码）、深度问答 rerank 超时兜底（catch→null + SelfRag.ask 包 retrieve）。typecheck/cargo/373+21 全绿。
- **背景音乐开关（♪）真正能开/关**：上一版 `readBgmBytes(file)` 传的是裸文件名，而 Rust `bgm_read` 内部 `ensure_within` 会 `canonicalize()` 候选路径——裸文件名按进程 CWD 解析必然失败 → 背景音乐全程加载不出，♪ 点了没反应。修复：`use-background-music` 重新取 `getAppPaths().resourceDir` 拼完整路径 `resourceDir/audio/backgrounds/{file}` 再传 `bgm_read`；另加 `bgmReloadKey` 参数——顶栏/音乐栏「开启」时自增，强制重新加载当前场景音乐（覆盖 autoplay 被拦 / stop 清掉 src 后再开）。
- **设置「启用陪伴角色」关掉后主界面宠物仍显示**：`SceneViewport` 的 `showPet` 只读本地 `settings.showPet`，没查 `companion.enabled`。改为 `showPet={settings.showPet && companionEnabled}`。
- **读取目录（导入文档用）没有可见作用**：`readDirs` 只同步到 Rust 白名单，UI 导入从不展示。新增 Rust 命令 `doc_list_readable`（列出各读取目录顶层可导入文档 pdf/md/txt/epub/mobi/azw3），知识面板「快速导入」新增「从读取目录导入」区块列出并可直接导入（文件在读取目录内，`file_read_text` 走 check_readable 直接读）。
- **快速/教练模型名可自由输入**：设置里两个模型下拉改为「输入框 + datalist」（可手打自定义模型名/标签，不再只限本机已装），改完即落库并同步 ModelRouter。
- **顶栏背景音乐开关（♪ 键）**：主页面加专门控制背景音乐开/关的按钮（TopHud 音量键旁，lucide `Music2`，`data-active` 亮/灭显示状态），独立于主音量键。新增 `toggleBackgroundMusic`：只切场景背景音乐 + 天气自定义歌，不碰音乐库（`toggleBgm` 仍归 LofiHud 用）。i18n 补「开启/关闭背景音乐」。
- **复盘确认不再暴露原始 JSON**：`ConfirmationModal` 之前对**所有**动作类型 `JSON.stringify(proposal.payload)` 到 `<pre>`，用户确认复盘写入时会直接看到代码式 JSON。改为 `generate_review` 走 `renderReviewPayload`（正文/洞察/下一步渲染成可读文本），其它动作保留 JSON 兜底。
- **Ollama 自动拉起**：新增 Rust 命令 `ollama_ensure_running`（`commands/model.rs`，注册进 lib.rs）——未运行则无窗口后台 `ollama serve`（Windows `CREATE_NO_WINDOW`），最多等 ~10 秒探活，返回 `already_running/started/failed`；前端 `paths-api.ensureOllamaRunning`，启动流程非阻塞调用，started/failed 给 toast。`cargo check` 过。注意：这只保证应用运行期间 Ollama 可用；登录自启需在 Ollama 托盘设置里勾「Launch at login」，或以后加注册表项。
- **背景音乐修复（use-background-music）**：`use-background-music.ts` 曾被半重构——`readBgmBytes`/`mimeByExtension` 引而未用、`convertFileSrcFn` 未定义（那是 sprite-manifest.ts 的局部变量）→ `npm run typecheck` 直接挂（TS2304/TS6133）、运行时 `apply()` 抛 ReferenceError → **所有背景内置音乐（含 spring_all.mp3）全程静默**。修复：改为文档意图的 `readBgmBytes(file)`（Rust `bgm_read` IPC 读字节）→ Blob → 循环播放，与音乐库同一可靠机制；去掉 resourceDir+asset:// 残留逻辑与死 import；读字节后再查 `getActiveSource()` 防「读字节期间用户开始放自己音乐被抢」。typecheck + 373 测试全绿。背景音乐存储位置：`src-tauri/resources/audio/backgrounds/`（bundle 资源，装到目标机 `resourceDir/audio/backgrounds`）。
- **TD-001（部分）** CSP 从 null 收紧为受限 CSP（connect-src 限本机/内网、object/frame none）；仍留 `script-src 'unsafe-inline'`（React-refresh 需要），未完全根治 XSS。
- **数据安全**：删除 `deleteCompletedBefore` 物理删除（历史任务/复盘不再被清）；每日备份搬进真实启动流程（之前挂在死代码里从未跑过）；备份改原子替换；`reopen` 等待事务结束。
- **存储地址热替换**：`file_set_app_paths` 校验目录（禁盘根/UNC/相对）、vec0.dll 只从捆绑目录加载、`file_write_text` 禁写 extensions/。
- **音频**：放弃/删除加确认弹窗（modal z-index 1000 盖过全屏专注层）；专注音乐手势重试；`playCustom` 取消令牌；音乐库只暂停不丢选中。
- **死代码清理**：删除 `App.tsx`、8 个 `pages/*`、`layout/*` 等 22 个死文件；移除死设置（defaultAmbient、allowSendingNoteContent）。
- **RAG 增强**：LLM Multi-Query + HyDE（深度检索开关）、章节父子块提升、多样性重排、检索结果展示（笔记标题+章节面包屑）、月度归纳视图。
- **Self-RAG 深度问答**：知识面板「深度回答」= 深度检索 + 生成 + 自我评判（相关性 / 有据 / 幻觉风险 / 质量）+ 不达标重生成一次；输出回答 + 引用来源 + 置信度；模型不可用降级为最相关片段。问答历史持久化（`ask_sessions`，011 迁移）：每次非空问答自动落库，知识面板可回看 / 删除。
- **流式输出**：`ModelCompletionRequest.onToken` + Router 透传；三路实现 —— Ollama（NDJSON 流）、llama.cpp（SSE 流）、Tauri 桌面（Rust `OllamaClient.complete_stream` + `model_complete_stream` 命令经 Channel 推增量）。Self-RAG 深度回答生成时逐字预览，最终以完整结果为准（增量只是预览）。
- **模型级 Rerank（cross-encoder）**：`RerankProvider` 端口 + `LlamaCppRerankProvider`（本地 llama-server `/rerank`，跑 bge-reranker 类模型）。深度检索优先用它，失败自动回退生成式 `ReRanker`，再失败保持启发式顺序（C3）。
- **启动 DB bug（duplicate column）**：letters 表曾被库外直接补过 `direction`/`type` 列、但 schema_migrations 没记录 14/15 → 启动 migrate 撞 `duplicate column name: direction` → 「数据库初始化没有完成」错误页。修复：`SqliteLetterRepository.syncSchemaState()`（列在而迁移未记录则补记）已在 initialize 开头调用；另在 `Database.migrate()` 加自愈——语句抛「duplicate column name / already exists」时视作终态已达、跳过并照常记录迁移，杜绝整类「库外改 schema 钉死启动」。
- **写信双栏按月份分组 + 回信独立成信**：寄出/收到两栏内按本地年月分组展示（月度标题 + 信封）。回信不再内联在原信 `reply` 字段：`WriteLetter` / `ProcessLetters` 生成回信时新建一条 `direction='in', type='reply'` 的来信入「收到」栏（旧数据回信仍内联展示，不迁移）。
- **单实例防叠窗口**：`tauri dev` 二次启动时旧 vite 占 5173、新实例照样拉起连同一个前端 → 每次重启叠一个新窗口。修复：`lib.rs` run() 顶部做 std-only 握手单实例守卫——所有实例按同一顺序争抢一组本地回环端口（57432-57436），成功绑定即本实例；绑定失败时连接该端口做魔数握手，确认是 NativeMind 才退出，是其它软件占用则顺延下一端口（避免某软件占了端口就永远打不开应用）。实测：二次启动被拦、窗口数保持 1；端口被外部占用时落到下一端口正常启动。不引第三方 crate（环境网络受限拉不了 tauri-plugin-single-instance）。
- **芙莉莲宠物 Sprite**：默认角色从 gugu-gaga 换为 fulilian（`src/ui/pets/fulilian.png`，1728×2304，5 列×8 行，帧 345.6×288）。`public/companions/fulilian/animations/` 新增 manifest+图，8 行逐行映射：趴着休息→sleep、拖动拎起→drag_lift/left/right/release、空闲打滚→idle、看向用户→look_at_girl、安静陪读→study_loop、等待输入→needs_input、结果准备好→ready/cheer、认真查看问题→examining（新动作，陪伴提问时触发）。`PetActor` 拖拽期间切对应帧；配置默认 assetBase、companionId、名字同步为 fulilian/芙莉莲。
- **软件 Logo**：`src/ui/components/ui/logo.png`（2048×2048）经 `tauri icon` 重新生成 `src-tauri/icons/`（窗口/托盘/打包图标），另放 `public/logo.png` 作 favicon。
- **主界面 UI 改版**：功能入口收成单个圆形按钮（点击展开/收起一排功能项）；Today/Focus/音乐等 HUD 与面板背景透明化（面板打开时其余 HUD 更透明）；「进入专注模式+统计时长」移到右下角（音乐栏上方）并透明；音乐栏左移不重叠；陪伴面板宠物改用 `companion.png`（放大展示）；气泡贴到宠物上方并加指向小角（修正了原先 translateY(-100%) 导致气泡离宠物过远的问题）。
- **图书馆场景**：接入 `图书馆_白天.png / 图书馆_夜晚.png`（场景感知，天气不再干扰）；图书馆下隐藏天气选择按钮。
- **todo 拆分提示词复杂化**：`todo-structuring.v1.md` 要求每个任务写清「具体内容+怎么做+完成标准」，按理解→练习→巩固→自查切分，禁止「学一会儿/看几页」类空泛任务。
- **专注快捷键 + 暂停**：专注全屏层空格 = 开始/暂停/继续（暂停为会话级 store 态、不落库，`remainingSeconds` 用 pausedAt 冻结有效流逝）；另加暂停/继续按钮与「已暂停」提示。
- **芙莉莲 sprite 换新图**：`即梦AI/fulilian/fulilian_动作图_抠图用.png`（1728×2304）用 C# 洪泛填充抠掉近白背景（保留人物内部白色），替换 `src/ui/pets/fulilian.png` 与运行资源，四角透明、人物保留。脚本 `scripts/cutout-fulilian.ps1` 可复用。
- **HUD 半透明毛玻璃（改版定稿）**：HUD（顶部/功能入口/专注/音乐/气泡/面板容器）统一加**半透明毛玻璃**：`backdrop-filter: blur(10-14px)` + `color-mix(var(--hud-bg) 26-46%)` 低不透明度背景（比最初 82-92% 更透），白天深字/夜晚白字跟随主题、`--hud-weight: 650` 加粗 + `--hud-halo` 光晕保证清晰。面板容器（demo-sheet）保持浅色毛玻璃 + 深字（内容可读）。顶部 HUD 右侧**固定白天/黄昏/夜晚循环切换按钮**（两个场景都有）。
- **18 张背景三时段适配**：6 组背景（日常/雨天/雪天/春日樱花/夏日萤火虫/图书馆）各白天/黄昏/夜晚（日常白天为视频），`backgrounds.ts` 按 `(weather, timePhase, scene)` 精确选图，图书馆只看三版不受天气干扰。功能展开横条改到**收纳按钮正左边**（垂直对齐）。
- **宠物放大一倍 + 加载防丢**：`PET_SPRITE_SCALE` 0.2→0.4；`configurePetSprite` 增加 sprite 图预加载校验——manifest 在但图加载失败时整体回退 CSS，避免「空白宠物」（全屏/非全屏同理）。宠物只在主场景渲染，专注全屏层无宠物（设计如此）。
- **背景视频静音**：所有背景视频（日常_白天.mp4）自带音频一律 muted，只留画面，移除视频音量/互斥订阅逻辑。
- **陪伴面板宠物改第 8 组动作**：陪伴界面宠物从静态 companion.png 改为 fulilian 第 8 组动作（认真查看问题，帧 35-39）循环动画，5 秒/帧，用已抠背景的 `fulilian.png`（透明），scale 0.6（约原图 0.8 倍）。
- **英文残留修复**：LofiHud / TopHud 硬编码中文（雨声/雪声/安静/目录提示/顺序/随机/暂停/播放/自定义背景音乐/音量等）全部套 `t()`；Review 日/周/月等映射本就有，组件已走 t()。
- **点击宠物实时调模型**：根因是 `InteractionPolicy.allowedScenes` 没有 `user_invoked`，点击宠物被策略拦成沉默。修：`TriggerInteractionInput.userInitiated` 标志，用户主动点击跳过策略节流、实时调 1.5B 模型给对话。
- **Letter 改「对话」历史会话**：保留写信功能与信封布局，双栏合并为**单栏历史会话**——每封信与它的回信归成一段对话（信封），点开显示往来气泡；Flora 主动来信自成一段。数据本就持久化在本地 SQLite（存储路径）。功能名「写信」→「对话」（dock / 面板标题 / i18n）。
- **宠物缩窗丢失修复**：`.fullscreen-cozy-home` 原 `min-width: 1180px` 固定场景宽，宠物锚在 70%（≈826px），窗口缩窄时右侧被裁 → 宠物跑出屏幕。放宽为 `min-width: 720px; min-height: 520px`，场景随窗口缩放、宠物保持可见。
- **宠物等待转圈**：点宠物 / 回应后调本地模型期间，`companion-store.generating` 置 true → 宠物右上角显示小转圈（`.pet-spinner`），模型返回文字后消失。
- **对话多段会话**：letters 加 `conversation_id`（迁移 016），对话按会话分组；`WriteLetterUseCase` 可续进会话（不传则新开），回信共享会话 id；新增 `listConversations` / `deleteConversation` 用例与 `deleteMany` 仓储方法。UI 改为「会话列表 + 多段聊天窗口」，可新对话、重进续聊、删除（本地一并删）。老数据（无 conversation_id）仍按寄出+回信归段展示。
- **功能总览文档**：`docs/功能总览.md`（约 500 行）——逐功能「UI → 功能 → 实现文件」对照表，覆盖 HUD/7 面板/宠物/场景背景/AI 层/数据层，含笔记「检索」完整链路（知识面板 → note-store → SearchNotesUseCase → RAGOrchestrator → 向量库）。
- **陪伴主动一拍接线**：`FullscreenCozyHome` 增加每 10 分钟 interval 调用 `companion-store.proactiveTick()`（策略仍拦专注/节流）。
- **宠物动作 5 秒/帧**：sprite manifest 的循环动作（idle/sleep_loop/study_loop/needs_input/examining/move_*/drag_*）fps 统一 0.2（5 秒一帧），一次循环 25 秒，更安静。
- **点宠物苏格拉底提问**：`InteractionGenerator.generateQuestion` 对 `user_invoked` 场景改用苏格拉底 prompt（概念复述/前提/反例/卡点/与笔记关联，要求有变化），并**明确禁止「这次反馈主要基于哪些方面」这类抽象元问题**；`fulilianVoice` 增加 `user_invoked` 兜底台词（随机取一条），模型不可用时也保证聊天框有内容。
- **设置模型下拉**：`paths-api.listInstalledModels`（invoke `model_list`）；设置页快速/教练模型从文本输入改为**下拉选择**，进设置自动拉取本机 Ollama 已装模型，点「检查可用性」会刷新列表，选中即切换（`updateModels` 落库）。
- **弹窗毛玻璃 + 可读性**：`.modal`（专注退出/删除/确认等所有弹窗）渲染在 app 内部，原继承主场景深色字 → 深色主题下深底深字看不清。改为 `color: var(--text)` 显式用主题文字色 + `color-mix(var(--surface) 84%)` 半透明 + `backdrop-filter: blur(18px)` 毛玻璃。
- **宠物点击随机互动**：去掉陪伴面板「问个问题」按钮；`user_invoked` 提示词改为**随机互动**（打招呼 / 随口关心「吃饭了吗/累不累」/ 轻巧问题，每次变化，仍禁抽象元问题），兜底台词混入问候/关心/问题。点击宠物时调小模型生成 + 右上角转圈（已有），生成后气泡显示。
- **点宠物无消息根因修复**：`ai/adapters.ts` 的 `SCENE_MAP` 没映射 `user_invoked` → 点击落到 `'feedback'`，随机互动分支不触发、兜底也变成「记下了」。补 `user_invoked: 'user_invoked'`；且宠物睡觉时点击也会在唤醒后紧跟一段模型互动（任何点击必有回应）。拖拽动画提/放节奏调慢（fps 3）更自然可爱。
- **背景音乐新命名适配**：`backgroundMusicFor` 改为按新文件名映射——`day.mp3`（日常全天）、`rain_all/snow_all/spring_all.mp3`（对应天气全天）、`library_day_dusk.mp3`（图书馆昼+昏）、`library_night.mp3`（图书馆夜）、夏日无曲目静默、两个长名文件为备用不映射。hook 保证：循环播放；同一 Audio 元素换 src（切换不重叠）+ cancelled 防竞态；`getActiveSource()` 检查——用户放音乐时背景音乐不抢，`silenceOthers` 互斥（音乐库/专注音乐同样生效）。
- **部署脚本**：新增 `setup_ollama.bat`（目标机一键装 Ollama + pull 三个模型）、`README-部署.md`。**坑**：`tauri build --bundles app` Windows 不支持；raw `cargo build` 不内嵌前端（运行时要 dist/ 且实测不加载）；音乐在 public/ 时 `tauri build` 内嵌 500MB → LLVM OOM / 6GB rlib 损坏（E0786）。
- **音乐改为 bundle 资源（关键修复）**：`public/audio/backgrounds/` 移到 `src-tauri/resources/audio/backgrounds/`（不再进 dist → 不内嵌，避免 OOM/rlib 损坏）；`tauri.conf.json` resources 改为 `"resources/audio": "audio"` + CSP media-src 加 `asset:`；`backgroundMusicFor` 返回文件名，`useBackgroundMusic` 用 `getAppPaths().resourceDir` + `convertFileSrc` 从资源目录加载（用户放音乐不抢、切场景不重叠、循环不变）。背景图仍内嵌（~40MB）。Cargo.toml 加了 `[profile.release] opt-level=1 codegen-units=16`（防大数组 OOM）。部署 = `npm run desktop:build`（NSIS 安装包）+ `setup_ollama.bat`。
- **18 背景内置音乐槽位**：`public/audio/backgrounds/{group}_{phase}.mp3`（group=clear/rain/snow/spring/summer/library × day/dusk/night），用户后续放音频即可；`useBackgroundMusic` 按 (场景,天气,时段) 自动播放对应文件（空文件静默），注册进 audio-exclusive 互斥并跟随主音量/静音。
- **透明 HUD 对比度**：浅/深主题各加 `--hud-halo` 文字光晕（浅底深字配浅光晕、深底浅字配深光晕），保证透明背景下文字在任何背景图上都清晰。后续再加强：浅/深主题文字比主页正文更深/更白（浅 `#0e1511` 近黑 / 深 `#fff`）、`--hud-weight: 650` 加粗、边框 alpha 提到 0.5-0.55、光晕更强。
- **功能收纳交互**：展开后点外部任意处或按 Esc 自动收回（不用再点按钮）。
- **时段循环**：顶部切换按钮从「白天/夜晚」改为「白天→黄昏→夜晚」循环，图标跟随当前时段（太阳/落日/月亮）。
- **Logo 换新**：`src/ui/components/ui/logo.png` 替换后重新 `tauri icon` 生成 `src-tauri/icons/` 并刷新 `public/logo.png`（favicon），顶部品牌位显示 logo（替换 Leaf 图标）。**坑**：只 touch 源文件重编译不足以换窗口图标——build 脚本产物缓存了旧图标，必须 `cargo clean -p nativemind` 后 `cargo build` 才会把新 .ico 真正嵌进 exe。已验证 exe 图标可提取（32x32）。

## Active Tech Debt（剩余）
- TD-001 完整版：`script-src 'unsafe-inline'` 仍未去（需改造 dev 的 React-refresh 注入或拆 prod/dev CSP）。
- TD-002 数据库加密、TD-004 PDF 结构、TD-005 迁移回滚、TD-006 内存驱动不完整、TD-007/008 测试覆盖仍待补。
- 无剩余 RAG 项：cross-encoder 与流式均已落地（见 Resolved）。

