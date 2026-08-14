# NativeMind 全项目 Bug 审查 + 功能优化整理

> 审查日期：2026-08-07 · 方法：五路并行 agent（UI / application+domain / AI / Rust / infrastructure）
> 状态：发现 + 建议，未逐条修；「本次会话已修复」一节列出了已处理项。

---

## 一、高危（建议优先修）

| # | 位置 | 问题 | 一句话修法 |
|---|------|------|-----------|
| H1 | `application/use-cases/flora/write-letter.ts:39` | `flora.sendLetter` 无 try/catch：模型超时/报错时用户外发信件**直接丢失**（连 pending 都没落）。 | 包 try/catch，失败也先存 `pending`，与 SendLetter/ProcessLetters 一致。 |
| H2 | `src-tauri/commands/file.rs:176-189` | `file_write_text` 只挡 `extensions/`，笔记/导出路径若撞上 `nativemind.db`、`-wal/-shm`、`backups/*.bak` 会**覆盖/损坏运行中的数据库或唯一备份**。 | 额外拒绝 DB 文件名与 `backups/` 子目录。 |
| H3 | `src-tauri/model_client/ollama.rs:300-301` | `complete_stream` 用 `from_utf8_lossy` **逐块**解码：多字节 UTF-8 字符被块边界切断 → 中文流式输出出现 `�` + 乱字节，甚至断掉 JSON 行解析丢 token。中文应用几乎必现。 | 按字节缓冲，切 `\n` 后再整行 `from_utf8`。 |
| H4 | `ai/rag/rerank.ts:93` + `self-rag.ts:107` | `withTimeout`（4s）无 catch，慢的教练模型重排直接 reject → `retrieve()` 抛错 → **整个深度问答崩**（self-rag 头注释承诺「失败降级」但没实现）。 | `rerank` 里 catch 超时返回 null；`SelfRag.ask` 包住 `retrieve`。 |

## 二、中危

| # | 位置 | 问题 | 一句话修法 |
|---|------|------|-----------|
| M1 | `application/use-cases/todo/create-todo.ts:131,159` | AI 任务写入走 `saveMany`/`replaceAll` 直接落库+发 `TodoConfirmed`，**绕过了 ConfirmationService**（无 action_proposal 审计记录），违反 AGENTS.md 确认门铁律。 | 走 `confirmAndCommit` 或至少记一条 proposal。 |
| M2 | `application/use-cases/note/delete-note.ts:18-42` | 删除笔记是写操作但**不发事件**（无 `NoteDeleted`），审计不可见，与导入/更新不一致。 | 加 `NoteDeleted` 事件并接入 audit-subscriber。 |
| M3 | `application/confirmation/confirmation-service.ts:66-74` | 先把 proposal 标 `confirmed` **再**跑 `commit`；commit 抛错（如 create-todo 空标题过滤）时库里留一条「已确认但什么都没写」的记录。 | commit 成功后再标 confirmed，或加 `failed` 态。 |
| M4 | `src-tauri/db/connection.rs:116-155` | `reopen` 不持锁地开关连接：中间若有事务 `BEGIN`，写落到将被丢弃的旧连接 → **存储热切换期间静默丢数据**。 | 先建新连接，再持锁校验 autocommit + 原子替换。 |
| M5 | `src-tauri/commands/db.rs:57-78`、`file.rs:390-524` | `VACUUM INTO`（整库拷贝）+ 目录迁移在**异步线程上同步执行**，大库会卡死所有 IPC。 | 包 `tokio::task::spawn_blocking`。 |
| M6 | `src-tauri/lib.rs:142-150` + `vector/sqlite_vec.rs` | 「vec0.dll 只从捆绑目录取」只在首次成立：`dest_vec.exists()` 就跳过复制，之后加载的是 `data_dir/extensions/vec0.dll`（用户可覆盖 data_dir）——**预置 DLL 可被加载执行**。`file.rs:180` 扩展名挡 check 用非 canonical 路径比较，junction/symlink 可绕过。 | 每次启动哈希比对捆绑 DLL（或强制覆盖），canonicalize 后再比较。 |
| M7 | `FullscreenCozyHome.tsx:643-646` | `applyAmbient` effect 缺 `settings.sceneId`/`timePhase` deps：切到无 bgm 的场景（summer）后内置环境音不启动（切场景后全静音），或残留旧环境音。 | 补进 dep 数组。 |
| M8 | `FullscreenFocus.tsx:134-142` | 一次性 `pointerdown` 监听**卸载时没移除**：选完专注音乐关掉全屏后，下一次点应用任意处会**在主界面无会话地偷播专注音乐**。 | 存 ref 在卸载 effect 里移除（或门控 overlay 状态）。 |
| M9 | `music-store.ts:127-161` | `playAt` 无请求序号：快速点歌/下一首时最慢的读取胜出 → **播错曲目**，且败者 revoke 掉胜者的 objectUrl。 | 加单调递增 token（照抄 `customPlayTokenRef`）。 |
| M10 | `settings-store.ts` + `SettingsPanel.tsx:504` | `focus.completionCue`（结束时提示音）是**死设置**：全项目无人播放完成音。 | `FocusSessionCompleted` 订阅里按开关播提示音。 |
| M11 | `ai/prompts/socratic.v1.md:33` + `adapters.ts:278` | prompt 用 `{{#feedbackHint}}`（Mustache 条件块），但 `fillTemplate` 只匹配 `{{word}}` → 字面量原样发给模型，adapter 里算好的 `feedbackHint` 是死代码。 | 改成 `{{feedbackHint}}` 并传入完整指令。 |
| M12 | `ai/router/model-config.ts:32-33` + `tier-config.ts` | coach 档 `qwen2.5:7b` 是**死配置**：`resolveModel` 把非 fast 全归到 `big`（14B）。14B 没装时还误判 coach 不可用 → 静默降到 1.5B。 | 让 coach 用自己配的模型，或删掉 coach.model 明确双模型。 |
| M13 | `ai/rag/self-rag.ts:125,149-158` | 初稿+精修稿共用同一 `onToken`，无重置信号 → UI 预览变成 `draft1+精修稿` 拼接，而返回的答案只有精修稿。 | 流式契约加「重置/清空」信号，或只流最终稿。 |
| M14 | `infrastructure/index.ts:133` + `tauri-runtime.ts:84` | embed 管道在 `createInfrastructure` 里硬绑了内部 HTTP `OllamaProvider`，tauri-runtime 只浅拷贝覆盖顶层字段 → **桌面端嵌入向量仍走 WebView fetch**（正是 tauri-model-provider 想避免的），还无视配置的 embeddingModel。 | 把 Tauri provider 注入 createInfrastructure，别事后覆盖。 |
| M15 | `infrastructure/vector-store/sqlite-vec-provider.ts:38-41` | 维度不匹配时 `DROP TABLE` 重建空表：存量向量全没，笔记却仍标 `indexed`，**无重建触发**。换同维模型还会混入不兼容向量空间。 | 记录版本/维度标记，embed-job 据此重跑。 |
| M16 | `infrastructure/db/database.ts:101` | `migrate()` 用宽正则吞掉**任何**「already exists」并照记迁移：真 schema 冲突被跳过 → 后续语句莫名失败。letters 场景已有精确自愈，这条是多余风险。 | 收窄到仅 duplicate column。 |
| M17 | `src-tauri/commands/model.rs:46-57` | `try_start_ollama` spawn 继承 stdin/out/err、无 `Stdio::null()`：子进程日志刷进应用 stdout，handle 丢弃后失败不可观测。 | 三流设 null，考虑 spawn_blocking + 退出等待。 |
| M18 | `src-tauri/commands/search.rs:63-133` | SSRF 加固缺口：host 校验与实际连接是两次 DNS（rebinding TOCTOU）；重定向目标在 `reqwest` **已抓取后**才校验。 | 自定义 connector 钉 IP，或 redirect 前校验每个 Location。 |
| M19 | `src-tauri/utils/mod.rs:109-119` | `ensure_writable_within` canonicalize 父目录后拼回叶名：若目标已存在是**指向目录外的 symlink/junction**，写入会跟出去逃逸 data_dir。 | 校验 `symlink_metadata`（拒绝符号链接叶）或 O_NOFOLLOW。 |

## 三、低危（一批）

**UI**
- `note-store.ts:355-371` — `clearSearch` 不重置 `searching`，搜索中清空会永久「正在检索…」。修：加 `searching:false`。
- `focus-music.ts:112-119` — `toggle()` 暂停分支不清 `clearActiveSource('focus')` → 背景视频一直静音、bgm 一直被拒。修：走 `pause()`。
- `use-background-music.ts` — bgm 在用户音乐停掉后不自动恢复（activeSource 回到 null 无订阅）。✅ cancelled-catch 已修（本次会话）。
- `SpriteRenderer.tsx:56-69` — 一次性动画结束后 rAF 仍在跑（~60fps 空转）。修：`if (ended) return`。
- `PetActor.tsx:47-57` — 宠物位置上报只依赖 `drag`，切场景/缩放窗口后气泡锚点漂移。
- `FullscreenCozyHome.tsx:367-373` — Esc keydown effect 无依赖数组，每次渲染重挂全局监听。
- i18n 缺口：`FullscreenFocus.tsx`、`ReviewPanel.tsx`、`ConfirmationModal.tsx`、`SimpleConfirmModal.tsx` 有硬编码中文不走 `t()`，英文界面会显示中文。

**application/domain**
- `import-note.ts:34-35` — 幂等重复导入直接返回已有笔记、不发 `NoteImported`，索引失败/挂起的旧笔记永远不再入队重建。
- `search-notes.ts:124-169` — `executeWithConfirmation` 绕过 localThreshold，blocked 返回路径漏 `localLowConfidence`。
- `archive-link.ts:18-37` — archive/restore 是写操作但不发事件不审计。
- `update-note.ts:23-49` — 无标题/正文校验（绕过 domain 的 validateTitle/Content）。
- `complete-focus.ts:23` / `abort-focus.ts:26` / `start-focus.ts:27` — 时长可为 0/负、跳过 domain 的 max 240 规则（`FocusSessionDomainService` 闲置）。
- `create-todo.ts:94-101` — 空标题过滤在 commit 内（用户确认「生成 N 个任务」后才抛），留下已确认但无行的 proposal。

**AI**
- `llama-cpp-provider.ts:86,111` — 忽略 `jsonSchema`，数组约束不生效，结构化输出频繁退回重试。
- `llama-cpp-provider.ts:71` — `loadedModel` 未设时 `isAvailable` 一律 true，名字不匹配到生成时才炸。
- `shared/utils.ts:35-37` — `extractJson` 用 `lastIndexOf`，模型在 JSON 后夹带文字会吞进 parse。
- `result-filter.ts:144-152` — 模型输出字符串 score → `NaN` 毒化排序/UI。
- `ollama-provider.ts:95-97` — 模型名匹配漏 `_`/`.` 分隔变体，误判不可用降级。

**Rust（低）**
- `commands/audio.rs:159-173` — `bgm_read` 用用户可覆盖的 resource_dir 当「捆绑资源」来源，且音频无大小上限（多 GB 文件整读进内存过 IPC）。
- `commands/audio.rs:181-191` — `audio_read_imported` 缺 `is_audio` 扩展名校验，成了「任意文件字节读取器」。
- `commands/model.rs:27-43` — `ollama_ensure_running` 等 10 次 × 最多 3s 探活 ≈ 实际 40s；启动中会重复 spawn。
- `model_client/ollama.rs:16,41` — `0.0.0.0` 被当「本机地址」。
- `lib.rs:191-202,254-273` — 托盘 tooltip 每 30s 开一条只读 SQLite 连接（阻塞）。
- `commands/file.rs:293-296` — `file_import_into_data_dir` 同名静默覆盖 + 无大小上限。
- `db/connection.rs:104-109` — 锁中毒时 `path()` 返回空 PathBuf 而非报错。

**infrastructure（低）**
- `vector-store/chroma-provider.ts:129-135` — `clear()` 用 name 而非 id 删集合，404 被吞，实为 no-op。
- `review-repository.ts:57` / `local-demo.ts:242` — `findByDate` 参数类型漏 `'monthly'`（端口契约错误）。
- `parse-note-job.ts:46-53` — 文件变更重解析时丢弃新 `pageRanges`。
- `focus-repository.ts:85-92` — `abortStaleActive` 不写 `aborted_at`。
- `rag/note-candidate-provider.ts:79` — UTC 日期切片，东八区跨日错位。
- `local-demo.ts:155-166` — `abortStaleActive` 改内存不持久化，刷新回退；`findActive` 返回最旧会话（与 SQLite 最新不一致）。
- `local-demo.ts:269-318` — 陪伴互动仓库不持久化（web 预览刷新即失）。
- `local-demo.ts:576-586` — `InMemoryJobQueue` 是无声漏桶：web 预览里 parse_note 永远卡住，笔记永远非索引态。
- `chroma-provider.ts:44` — 默认维度 384 与 sqlite-vec 768 不一致。
- `support-repositories.ts:242-246` — 被跳过的模型运行记成 `validation_result='success'`。

## 四、优化 / 架构（本次已做 O1–O6，见第六节）

1. **`src/domain/` 是死代码且模型与运行层分歧**（application agent）——`TodoStatus` 的 `abandoned` vs 端口 `cancelled`、`FocusState.PAUSED` vs 三态、`ReviewType` 缺 `monthly`、`Note.type` vs `sourceType`。业务规则（状态机/校验）在 use-case 里 ad hoc 重写。建议：接线进 use-case 或删掉整层。
2. **最深残余风险：`db_select`/`db_execute` 裸 SQL + `file_write_text`/`file_read_text`/`file_import_into_data_dir` 任意文件读写都暴露给 WebView**，只靠前端自己约束；渲染层一旦 XSS 就 = 全库+全盘。建议加命令级 capabilities 白名单。
3. **周/月复盘复用日复盘 prompt 且限 200-400 字**——30 天摘要用「日复盘」措辞和短文指导，schema 明明允许 4000 字。按 reviewType 参数化。
4. **启动重复刷新**：7 个面板常驻挂载各自 `refresh()` + FullscreenCozyHome 启动再刷一次 = 6+ 次重复 DB/IPC 调用。
5. **审查 N+1**：周/月复盘循环 `findByDate(day)` × 7/30 次 IPC；SQLite 侧 `findByDateRange` 已实现但从没人调（死代码）。RAG 每 term 一条 FTS 查询。
6. **`withTimeout` 定时器从不 clear**（rerank/self-rag/query-rewriter/flora）——败者 timer 空转保活。
7. **死代码/死配置**：AI 层 `intent`/`tag_generation`/`search_result_filter`/`todo_breakdown`/`long_document_analysis` 任务类型零调用；`AppExitingEvent` 从未发布；`pet-question.ts` 苏格拉底提问没人调；`formatCountdown`/`selectPendingTodos`/`addEn`/`SpeechBubble.onRespond/onDismiss` 等未用导出。
8. **`mergeShortChunks` 只合并「上一块短」**——独立短块后接正常块会留碎片，检索散。应改成当前块短就并入上一块。
9. **`promise.all` 无上限**：`adapters.ts:330-335` 每个搜索结果并发生成 light_summary，大结果集打爆本地模型。
10. **Rust vs TS 模型可用性缓存不对称**：Rust `model_is_available` 每次 HTTP 拉 `/api/tags`，TS 侧有缓存——生产路径每次 tier 检查都一趟往返。
11. **`music-store.playAt` 先 `silenceOthers` 再异步读字节**：读取期间背景视频静音、bgm 被停，读失败才恢复。改成读完再互斥+播放。
12. **阻塞 I/O 集中**：`db_integrity_check`、`focus_remaining_minutes`、托盘轮询都该走 `spawn_blocking`。`VACUUM-tmp-rename` 与 PRAGMA 批次在 db.rs/file.rs 重复，抽公共函数。

## 四补、重大发现：内置音效库全空

`audio-player` 引用的 `/audio/ambient/*`（雨/雪/晴日环境音）、`/audio/cue/*`（开始/完成提示音）、`/audio/companion/*`（宠物问候）在仓库里**没有任何音频文件**（`find` 全仓无 `.wav`；`public/audio` 空、`resources/audio` 只有 `backgrounds/`）。即：内置环境音、所有提示音、陪伴问候音从始至终是**静默**的（`new Audio()` 404 → 被 AudioPlayer 吞掉）。本次只补了 `complete.wav`（专注结束提示）。**建议后续把整套音效补齐**（雨/雪/晴日环境音 + start/companion 等），否则相关 UI 一直无声。

## 五、已核实非问题（审过无 bug）

- 16 个迁移全部注册、顺序正确、版本与文件名一致；005/007/008/009 重建索引无误。
- 动态 SQL 全走绑定参数；FTS `MATCH` 已转义 `"` 并参数化。无 SQL 注入。
- local-demo 没有任何「未实现但 UI 可达」的抛错（`parse` 对 `kind:'path'` 的抛错是 web 预览刻意的）。
- infra 侧无事件订阅泄漏（`setOnIndexed` 是一次性 setter）。
- `AppPaths` 锁全部单取不嵌套；`DbConnection` 互斥获取顺序一致 → 无 RwLock/互斥死锁。
- `companion_interactions.scene_type` CHECK 覆盖了应用/AI 层写的每个场景值。
- 结构化的模型 JSON **不会**原样漏给用户（AI agent 专项核实；唯一的 JSON 暴露点是确认弹窗，本会话已改成可读预览）。

## 六、本次会话已修复（已过 typecheck / cargo check / 373 TS 测试 / 21 Rust 测试）

- **H1 写信丢信件**（`write-letter.ts`）：`flora.sendLetter` 包 try/catch，模型报错/超时先落 pending 由 ProcessLettersUseCase 补发，用户内容不再丢。
- **H2 file_write_text 保护 DB**（`file.rs:176`）：拒绝写 `extensions/`（vec0.dll）、`backups/`（恢复快照）与 `nativemind.db` / `-wal` / `-shm`（运行中整库）；路径语义用 canonical 后祖先段比较，junction/symlink 下也成立。
- **H3 流式中文乱码**（`ollama.rs complete_stream`）：NDJSON 改为字节缓冲、整行才 `from_utf8` 解码，多字节字符跨 chunk 不再被拆成 �。
- **H4 深度问答崩溃**（`rerank.ts` + `self-rag.ts`）：`rerank` 超时/报错 `.catch(() => null)` 保持原顺序；`SelfRag.ask` 包住 `retrieve`，失败降级为空结果不再打穿。
- **M3 确认门先 confirmed 后 commit**（`confirmation-service.ts`）：commit 成功后才标 confirmed；commit 抛错 proposal 停在 pending，不再留「已确认但没写入」的假记录。
- **M2 删笔记发事件**（`delete-note.ts` + `event-types.ts` + `audit-subscriber.ts`）：新增 `NoteDeleted` 事件，删除后发布并纳入审计。
- **M1 AI 任务写入过确认门**（`create-todo.ts`）：`executeDrafts`/`executeReplaceDrafts` 改走 `confirmAndCommit`（`requiresConfirmation: false` 只补 action_proposal 审计、不再弹第二个框），每条 AI 建议型写入都有记录。
- **M7 applyAmbient 缺 deps**（`FullscreenCozyHome.tsx`）：effect 补 `settings.sceneId` + `timePhase`（并把 `timePhase` 声明提前，修 TDZ）；切到无 bgm 的夏日不再全静音。
- **M8 专注音乐偷播**（`FullscreenFocus.tsx`）：自动播放重试的 `pointerdown` 监听存 ref，全屏卸载时移除，不再在主界面无会话地偷播。
- **M9 音乐库播错曲目**（`music-store.ts`）：`playAt` 加请求序号 token，慢读取不再覆盖新选择 / revoke 新曲目的 objectUrl；`stop()` 自增作废在途请求。
- **M4 存储热切换竞态**（`db/connection.rs`）：`reopen` 先建新连接、再持锁「校验无事务 + 原子替换」，修掉校验后换连接前窗口里 BEGIN 落旧连接导致的静默丢数据。
- **M5 阻塞 VACUUM**（`commands/db.rs`）：`db_backup` 的 `VACUUM INTO` 移进 `tokio::task::spawn_blocking`（用独立连接做一致快照，不占主连接锁），大库不再冻住异步运行时。`migrate_data` 属用户主动触发的罕见热切换，保持同步。
- **M6 vec0.dll 信任**（`lib.rs`）：每次启动都从**捆绑目录**覆盖 `extensions/vec0.dll`（在 load 前），配 H2 的禁写扩展目录，杜绝预置/替换 DLL 被 `load_extension` 执行。
- **M17 ollama 子进程 stdio**（`commands/model.rs`）：`ollama serve` 三路 stdio 设 `Stdio::null()`，不再继承控制台/刷日志。
- **M18 SSRF 重定向**（`commands/search.rs`）：重定向用 `Policy::custom` **在跟随前**校验每个目标 host 是公网（含跳进本机 Ollama 11434 的拦截），并加同步版 host 校验；DNS rebinding 二次拦截。
- **M19 写入 symlink 逃逸**（`utils/mod.rs`）：`ensure_writable_within` 对已存在的符号链接/junction 叶用 `symlink_metadata` 拒绝，写入不再跟着链接逃出 data_dir。
- **M10 结束时提示音**（`FullscreenCozyHome` + 新增 `public/audio/cue/complete.wav`）：`FocusSessionCompleted` 订阅里按 `focus.completionCue` 播 `focus_complete`（事件回调读 store 当前值）。生成器脚本用完已删，音效可重新生成。
- **M11 苏格拉底 prompt 占位符**（`socratic.v1.md` + `adapters.ts`）：`{{#feedbackHint}}` 改为 `{{feedbackHint}}`（fillTemplate 只匹配 `{{word}}`），adapter 直接把「先回应上一轮再提问」的完整指令作为值传入，不再发字面量死文本。
- **M13 Self-RAG 流式预览拼接**（`self-rag.ts` + `note-store.ts` + 类型层）：`onToken` 契约加 `reset?: boolean`，精修稿生成前发 reset 让 UI 清空旧草稿预览，避免 draft1+精修稿拼在一起。
- **M12 coach 档死配置**（`tier-config.ts`）：`coach.model=qwen2.5:7b` 从不被读（`resolveModel` 把 coach/deep 都归到 big）。改为与 deep 一致并加注释：模型名由设置里 small/big 决定，tier-config 的 model 只是默认种子。双模型设计显式化。
- **M14 embed 管道绕 Tauri IPC**（`infrastructure/index.ts` + `tauri-runtime.ts`）：`InfrastructureConfig.modelRuntime` 加 `{ kind: 'custom', provider }` 分支，桌面端直接注入 Tauri IPC 版 provider——embedJob 等内部引用也用上它，不再事后浅拷贝覆盖导致嵌入仍走 WebView fetch。
- **M15 向量维度不一致清库**（`sqlite-vec-provider.ts` + `vector-store-interface.ts` + `infrastructure/index.ts`）：维度变化 DROP 后把已 indexed 的笔记全部打回 `stale`（`didRebuild` 标记），启动装配层检测到就把 stale 笔记重新入队 `parse_note` 整体重建——不再静默丢向量、笔记假标 indexed。Chroma 侧补 `didRebuild=false`。
- **M16 迁移过吞错误**：**保持原状（by design）**。审查建议收窄到仅 duplicate-column，但会打破单测覆盖的「表被库外提前创建→跳过并记为已应用」恢复机制。已在 database.ts 加注释说明取舍。
- **O1 复盘 N+1**（`generate-weekly/monthly-review.ts` + `ports.ts` + `local-demo.ts`）：`findByDateRange(from,to)` 暴露到端口并在两个仓库实现（SQLite 本就有，内存 demo 补上），周复盘 14 次 IPC → 2 次并行、月复盘 60 次 → 2 次。
- **O2 withTimeout 定时器泄漏**（`rerank` / `self-rag` / `query-rewriter` / `flora-agent`）：竞态改手动 Promise + 结果到达即 `clearTimeout`，败者 timer 不再空转保活（flora 最多 30s）。
- **O3 短块合并**（`chunk-strategy.ts`）：改为「当前块过短」就并入上一块（原来只看上一块短，独立短块后接正常块留碎片），`maxChars` 兜底防无限吞并。
- **O4 周/月复盘 prompt 参数化**（`review-daily.v1.md` + `adapters.ts`）：正文长度指导改为 `{{contentLength}}`，日 200-400 / 周 600-1200 / 月 1500-3000 字，30 天摘要不再被 400 字压成一团。
- **O5 音乐库先读再互斥**（`music-store.ts`）：`playAt` 读字节成功后才 `silenceOthers`，读取期间背景视频不静音、bgm 不被停，读失败也不白停当前声音。
- **O6 light_summary 并发上限**（`adapters.ts`）：搜索结果摘要从一次性 `Promise.all` 改为每批 4 条，不再几十路并发打爆本地 Ollama。


- 背景内置音乐全静默（`convertFileSrcFn` 未定义 → ReferenceError）+ 读字节传裸文件名导致 `bgm_read` canonicalize 失败 → 改完整路径 + `bgmReloadKey` 重载。
- 顶栏 ♪ 背景音乐开关（独立于主音量键、不碰音乐库）。
- 设置「启用陪伴角色」关掉后主界面宠物仍显示。
- 读取目录（导入文档用）配置后无可见作用 → `doc_list_readable` + 知识面板「从读取目录导入」列表。
- 快速/教练模型名可自由输入（下拉 → 输入框+datalist）。
- 复盘确认弹窗不再把原始 JSON 丢给用户（改可读正文预览）。
- Ollama 自动拉起（`ollama_ensure_running`）。
- `use-background-music` effect 卸载后读失败误停当前音频（cancelled 保护）。
