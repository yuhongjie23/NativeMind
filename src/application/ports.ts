/**
 * 应用层端口（Ports）
 * 用例只依赖这些接口，具体实现由 infrastructure / ai 层提供并在 bootstrap 注入。
 */
import type { ISO8601DateTime, UUID } from '@shared-types/common';

/* ---------- 领域数据模型（最小可用形态） ---------- */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type Priority = 'low' | 'medium' | 'high';

export interface Todo {
  id: UUID;
  title: string;
  description?: string;
  status: TodoStatus;
  priority?: Priority;
  estimatedMinutes?: number;
  scheduledDate?: string;
  /** AI 拆分任务组软连接：同一目标拆出的多条 todo 共享同一 sourceGoalId，无外键 */
  sourceGoalId?: UUID;
  tags: string[];
  linkedNoteIds: UUID[];
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
  completedAt?: ISO8601DateTime;
}

export interface FocusSession {
  id: UUID;
  todoId?: UUID;
  durationMinutes: number;
  /** 实际专注分钟数（提前结束按真实时长记）；缺省回退 durationMinutes */
  actualMinutes?: number;
  startedAt: ISO8601DateTime;
  completedAt?: ISO8601DateTime;
  abortedAt?: ISO8601DateTime;
  abortReason?: string;
  status: 'active' | 'completed' | 'aborted';
  notes?: string;
}

export type NoteSourceType = 'manual' | 'imported_pdf' | 'imported_markdown' | 'imported_text';

export interface Note {
  id: UUID;
  title: string;
  content: string;
  contentHash: string;
  sourceType: NoteSourceType;
  sourceUri?: string;
  indexStatus: 'pending' | 'parsing' | 'chunking' | 'indexing' | 'indexed' | 'failed' | 'stale';
  tags: string[];
  /** PDF 的页 → 字符区间，查看长文时定位页码用 */
  pageRanges?: NotePageRange[];
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

/** PDF 解析出的页与字符区间（start/end 是拼接后正文里的字符偏移） */
export interface NotePageRange {
  page: number;
  start: number;
  end: number;
}

export interface ReviewLog {
  id: UUID;
  reviewType: 'daily' | 'weekly' | 'monthly';
  date: string;
  content: string;
  summary?: string;
  statistics?: Record<string, number>;
  insights: string[];
  nextTodos: string[];
  /** 写入此复盘草稿的确认提案 id（崩溃恢复时精确判定 commit 是否已完成） */
  sourceProposalId?: string;
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

export interface CompanionInteraction {
  id: UUID;
  companionId: string;
  sceneType: string;
  triggerEvent?: string;
  interactionType: 'animation' | 'dialogue' | 'question';
  content?: string;
  userResponse?: string;
  animationName?: string;
  requiresResponse: boolean;
  /** 会话分组 id：提问与反馈共享同一段对话（P1-7） */
  conversationId?: UUID;
  /** 回应的是哪条互动（feedback 指向被回答的 question） */
  replyToId?: UUID;
  /** 会话内轮次序号（从 0 起，桌宠对话限制 2-3 轮用） */
  turnIndex?: number;
  /** 谁发起的：用户点击 / 事件 / 主动调度 */
  initiator?: 'user' | 'event' | 'proactive';
  /** 生命周期状态：可见 / 已回答 / 已忽略 / 已过期 */
  status?: 'visible' | 'answered' | 'dismissed' | 'expired';
  /** 消息角色：pet / user / system（页面按 conversationId 分组渲染用） */
  role?: 'pet' | 'user' | 'system';
  createdAt: ISO8601DateTime;
}

export interface SocraticSession {
  id: UUID;
  topic: string;
  relatedNoteIds: UUID[];
  status: 'active' | 'completed' | 'abandoned';
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

export interface SocraticExchange {
  id: UUID;
  sessionId: UUID;
  turnNumber: number;
  question: string;
  userResponse?: string;
  aiFeedback?: string;
  createdAt: ISO8601DateTime;
}

/**
 * 知识关系的端点类型与关系类型。
 *
 * 这里的取值必须与 001_init.sql 里 knowledge_links 的 CHECK 约束、
 * 以及 domain/knowledge-link 的枚举保持一致，三处对不上就会写库失败。
 */
export type LinkEntityType = 'note' | 'chunk' | 'concept' | 'todo' | 'review_item';

export type LinkRelationType =
  | 'same_concept'
  | 'prerequisite'
  | 'example_of'
  | 'contrast'
  | 'extends'
  | 'review_later';

/** 建表时就允许 rule_based，保留给后续的规则引擎 */
export type LinkCreatedBy = 'ai_suggestion' | 'user_manual' | 'rule_based';

export interface KnowledgeLink {
  id: UUID;
  fromType: LinkEntityType;
  fromId: UUID;
  toType: LinkEntityType;
  toId: UUID;
  relationType: LinkRelationType;
  /** 为什么建立这个关系。AI 建议必须给理由，否则用户无从判断该不该确认 */
  reason?: string;
  confidence?: number;
  createdBy: LinkCreatedBy;
  confirmedByUser: boolean;
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
  /** 归档代替物理删除，避免同一条关系被反复建议 */
  archivedAt?: ISO8601DateTime;
}

/** 查询某个实体的关系时用的筛选条件 */
export interface KnowledgeLinkQuery {
  /** 只看某个端点相关的边；不传则查全部 */
  entity?: { type: LinkEntityType; id: UUID };
  relationTypes?: LinkRelationType[];
  /** 默认 false：只返回未归档的 */
  includeArchived?: boolean;
  /** 默认 false：AI 未确认的建议也一并返回，交由 UI 区分展示 */
  onlyConfirmed?: boolean;
  limit?: number;
}


/* ---------- Repository 端口 ---------- */

export interface TodoRepository {
  findById(id: UUID): Promise<Todo | null>;
  findByDate(date: string): Promise<Todo[]>;
  /** 日期区间聚合（周/月复盘用，避免逐日 N 次 IPC） */
  findByDateRange(from: string, to: string): Promise<Todo[]>;
  findByStatus(status: TodoStatus, limit?: number): Promise<Todo[]>;
  save(todo: Todo): Promise<void>;
  saveMany(todos: Todo[]): Promise<void>;
  delete(id: UUID): Promise<void>;
  /** 事务化替换：删除原任务并把新任务整批写入（拆解「替换为拆分」用，避免删了写不进丢数据） */
  replaceAll(deleteId: UUID, todos: Todo[]): Promise<void>;
}

export interface FocusRepository {
  findById(id: UUID): Promise<FocusSession | null>;
  findActive(): Promise<FocusSession | null>;
  /** 回收崩溃遗留的超时 active 幽灵会话，返回清理条数 */
  abortStaleActive(maxAgeHours?: number): Promise<number>;
  findByDate(date: string): Promise<FocusSession[]>;
  /** 日期区间聚合（周/月复盘用，避免逐日 N 次 IPC） */
  findByDateRange(from: string, to: string): Promise<FocusSession[]>;
  /** 近 N 天内中断次数（默认 7 天），防止陈旧的中断记录一直触发提示 */
  countAbortsByTodo(todoId: UUID, withinDays?: number): Promise<number>;
  save(session: FocusSession): Promise<void>;
}

export interface NoteRepository {
  findById(id: UUID): Promise<Note | null>;
  findByContentHash(hash: string): Promise<Note | null>;
  /** 按标签查笔记（任一枚标签命中即返回），标签参与检索时用 */
  findByTags(tags: string[], limit?: number): Promise<Note[]>;
  /** 按 id 批量取笔记（候选标题标注用，避免逐个 findById 发 N 次查询） */
  findByIds(ids: UUID[]): Promise<Note[]>;
  save(note: Note): Promise<void>;
  delete(id: UUID): Promise<void>;
}

/** 删除笔记时清理它的向量（note_chunk_embeddings 不走外键级联） */
export interface NoteVectorCleanupPort {
  deleteByNote(noteId: string): Promise<void>;
}

export interface ReviewRepository {
  findById(id: UUID): Promise<ReviewLog | null>;
  findByDate(date: string, reviewType: 'daily' | 'weekly' | 'monthly'): Promise<ReviewLog | null>;
  save(review: ReviewLog): Promise<void>;
  delete(id: UUID): Promise<void>;
}

export interface CompanionInteractionRepository {
  create(interaction: CompanionInteraction): Promise<CompanionInteraction>;
  findById(id: UUID): Promise<CompanionInteraction | null>;
  findLastQuestion(): Promise<CompanionInteraction | null>;
  /** 最近一条互动（任意类型），主动调度节流用 */
  findLast(): Promise<CompanionInteraction | null>;
  countTodayQuestions(): Promise<number>;
  /** 今天某个场景的互动数（主动调度按场景计日上限） */
  countTodayByScene(scene: string): Promise<number>;
  updateResponse(id: UUID, response: string): Promise<void>;
  /** 最近的互动（上下文构建用：recentTurns/recentLines） */
  listRecent(limit?: number): Promise<CompanionInteraction[]>;
}

export interface SocraticRepository {
  saveSession(session: SocraticSession): Promise<void>;
  findSession(id: UUID): Promise<SocraticSession | null>;
  /** 会话列表，最近的在前。UI 要能回看历史会话，不只是当前那个 */
  listSessions(limit?: number): Promise<SocraticSession[]>;

  saveExchange(exchange: SocraticExchange): Promise<void>;
  countExchanges(sessionId: UUID): Promise<number>;
  listExchanges(sessionId: UUID): Promise<SocraticExchange[]>;
}

export interface KnowledgeLinkRepository {
  findById(id: UUID): Promise<KnowledgeLink | null>;
  /** 按条件查询；无条件时返回未归档的全部（受 limit 约束） */
  query(query: KnowledgeLinkQuery): Promise<KnowledgeLink[]>;
  /**
   * 查同一条边是否已存在（忽略方向以外的字段）。
   * 用于 AI 反复建议同一关系时做幂等，避免撞唯一索引报错。
   */
  findEdge(edge: {
    fromType: LinkEntityType;
    fromId: UUID;
    toType: LinkEntityType;
    toId: UUID;
    relationType: LinkRelationType;
  }): Promise<KnowledgeLink | null>;
  save(link: KnowledgeLink): Promise<void>;
  /** 归档，不物理删除 */
  archive(id: UUID, archivedAt: ISO8601DateTime): Promise<void>;
  /** 撤销归档 */
  restore(id: UUID, updatedAt: ISO8601DateTime): Promise<void>;
  /**
   * 物理删除某实体关联的全部边（实体被删时调用，归档保留悬空边没意义）。
   * 实体既可能是起点也可能是终点，两侧都要删。
   */
  deleteByEntity(entity: { type: LinkEntityType; id: UUID }): Promise<void>;
}
/** AI 给出的知识关联建议（端点收拢为「笔记」，UI 展示用） */
export interface LinkSuggestionCandidate {
  toType: LinkEntityType;
  toId: UUID;
  relationType: LinkRelationType;
  reason: string;
  confidence: number;
  /** 相关片段摘要，UI 展示「为什么相关」 */
  excerpt: string;
}

/** 检索相似旧笔记并判断关系（只产出建议，写库走确认） */
export interface KnowledgeLinkSuggestionPort {
  suggestForNote(
    content: string,
    excludeNoteIds: UUID[],
    limit?: number,
    /** 新笔记已有的标签：并入 HyDE 假设标签一起检索（标签是用户打的摘要，相关性有保证） */
    existingTags?: string[]
  ): Promise<LinkSuggestionCandidate[]>;
}



export interface AuditRepository {

  log(entry: { eventType: string; payload: unknown; timestamp: ISO8601DateTime }): Promise<void>;
}

/* ---------- 检索与 AI 端口（只产出草稿，不写库） ---------- */

export interface SearchHit {
  chunkId: UUID;
  noteId: UUID;
  text: string;
  score: number;
  /** 所属章节路径（子块聚合后的父块上下文） */
  headingPath?: string[];
  /** 命中段落在原笔记正文中的字符起始偏移（UI 定位用） */
  charStart?: number;
}

export interface NoteSearchPort {
  /** deep=true 时走深度检索（LLM Multi-Query + HyDE），慢但更准 */
  search(query: string, limit: number, deep?: boolean): Promise<SearchHit[]>;
}

/* ---------- 深度问答（Self-RAG）：检索 + 生成 + 自我评判，只读不写库 ---------- */

export interface AskNotesQuestion {
  question: string;
  /** 深度检索（Multi-Query + HyDE + 重排）；深度问答本身就走慢路径，默认 true */
  deep?: boolean;
  /** 排除的笔记 id */
  excludeNoteIds?: string[];
  /** 流式预览回调：生成回答时逐段触发，UI 渐进展示；最终以 answer 为准。reset=true 清空旧预览（重生成精修稿时用） */
  onToken?: (delta: string, reset?: boolean) => void;
}

export interface AskNotesAnswer {
  /** 生成的回答；模型不可用时为「最相关片段」最佳努力 */
  answer: string;
  /** 引用的笔记片段 */
  citations: SearchHit[];
  /** 归一化置信度 0-1 */
  confidence: number;
  /** 自我评判是否成功执行 */
  judged: boolean;
  /** 是否触发过重生成 */
  regenerated: boolean;
  /** 无相关笔记 */
  empty: boolean;
  /** 模型生成是否成功（false 表示已降级） */
  ok: boolean;
  /** 评判意见，UI 低置信时可展示 */
  critique?: string;
}

export interface AskNotesPort {
  ask(input: AskNotesQuestion): Promise<AskNotesAnswer>;
}

/* ---------- Flora 写信（通读 → 情感 → 回信 → 验证） ---------- */

export type FloraLanguage = 'zh' | 'en';

export interface FloraEmotion {
  emotion: string;
  summary: string;
  tone: string;
}

export interface FloraReply {
  reply: string;
  emotion?: FloraEmotion;
  verified: boolean;
  regenerated: boolean;
  ok: boolean;
}

export interface FloraPort {
  sendLetter(input: { letter: string; language: FloraLanguage }): Promise<FloraReply>;
}

/* ---------- Flora 信件（排队，半天后回信） ---------- */

export type LetterLanguage = FloraLanguage;

/** 来信类型：encourage=学习鼓励（每月一次），whats_up=Flora近况（网络搜索），warm=温暖鼓励，reply=对用户来信的回信 */
export type LetterType = 'encourage' | 'whats_up' | 'warm' | 'reply';

/** 一封信：写信后先排队，到 sendAfter 才由 ProcessLetters 生成回信 */
export interface Letter {
  id: UUID;
  letter: string;
  language: LetterLanguage;
  /** out=寄出（用户→Flora）；in=收到（Flora→用户，每日概率来信） */
  direction: 'out' | 'in';
  type: LetterType;
  /** 到达该时刻后才生成回信（当前固定半天） */
  sendAfter: ISO8601DateTime;
  status: 'pending' | 'sent';
  reply?: string;
  emotion?: FloraEmotion;
  createdAt: ISO8601DateTime;
  sentAt?: ISO8601DateTime;
  /** 多段对话的会话 id：同一段对话的来信/回信共享；老数据为 undefined */
  conversationId?: string;
}

/** settings 表的 key/value 最小端口（每日来信的抽签标记等） */
export interface SettingsKeyValuePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface LetterRepository {
  save(letter: Letter): Promise<void>;
  /** 最近在前 */
  list(limit?: number): Promise<Letter[]>;
  /** 到期未发的（sendAfter <= nowIso） */
  listPendingDue(nowIso: string): Promise<Letter[]>;
  /** 删除一段对话的全部信件（本地删除） */
  deleteMany(ids: string[]): Promise<number>;
}

/* ---------- 深度问答历史（AskSession 持久化，可回看 / 删除） ---------- */

/** 一次深度问答引用的笔记片段，与检索候选对齐 */
export interface AskCitation {
  chunkId: UUID;
  noteId: UUID;
  text: string;
  score: number;
  headingPath?: string[];
}

/** 一次已落库的深度问答记录 */
export interface AskSession {
  id: UUID;
  question: string;
  answer: string;
  citations: AskCitation[];
  /** 归一化置信度 0-1 */
  confidence: number;
  judged: boolean;
  regenerated: boolean;
  /** 模型是否成功生成（false = 降级为最相关片段） */
  ok: boolean;
  /** 无相关笔记 */
  empty: boolean;
  critique?: string;
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

export interface AskSessionRepository {
  save(session: AskSession): Promise<void>;
  /** 历史问答，最近的在前 */
  list(limit?: number): Promise<AskSession[]>;
  delete(id: UUID): Promise<boolean>;
}

/* ---------- 每日打卡（任务完成度 + 学习时长，供日历与效率分析） ---------- */

/** 单日打卡快照。任务/专注重算后落库，供日历展示与后续学习效率分析 */
export interface DailyCheckIn {
  /** YYYY-MM-DD */
  date: string;
  tasksTotal: number;
  tasksCompleted: number;
  /** 当日完成的专注分钟（提前结束按实际时长） */
  focusMinutes: number;
  /** 当日学习目标分钟数，学习进度 = focusMinutes / studyGoalMinutes */
  studyGoalMinutes: number;
  /** 当日所有任务完成 = 打卡成功 */
  checkInDone: boolean;
  updatedAt: ISO8601DateTime;
}

export interface DailyCheckInRepository {
  save(checkIn: DailyCheckIn): Promise<void>;
  get(date: string): Promise<DailyCheckIn | null>;
  /** 某月（YYYY-MM）的全部记录，日历用 */
  listMonth(yearMonth: string): Promise<DailyCheckIn[]>;
}

/**
 * 每日应用使用时长（复盘统计用）。
 * app_active_seconds 含专注与非专注；focus_seconds 是其中专注模式的累计，
 * 分开存不互减——「今天用了多久」和「专注了多久」是两个独立视角。
 */
export interface AppUsage {
  /** YYYY-MM-DD（本地时区） */
  date: string;
  /** 应用打开的累计秒数（含专注） */
  appActiveSeconds: number;
  /** 其中专注模式的累计秒数 */
  focusSeconds: number;
  updatedAt: ISO8601DateTime;
}

export interface AppUsageRepository {
  /** 按日累加（存在则加增量，不存在则建行） */
  add(date: string, appActiveSeconds: number, focusSeconds: number): Promise<void>;
  get(date: string): Promise<AppUsage | null>;
  /** 某日期区间（含两端）的所有记录，复盘统计用 */
  listRange(from: string, to: string): Promise<AppUsage[]>;
}

/** 单条搜索结果的 AI 整理：快速模型摘要 + 教师模型软推荐 */
export interface SearchResultEnhancement {
  id: string;
  /** 快速模型一句话摘要（≤30 字） */
  summary: string;
  /** 教师模型软推荐排名（1 = 最推荐；0 = 未参与排序，保持原顺序） */
  rank: number;
  /** 教师模型推荐理由（软推荐） */
  reason?: string;
}

export interface SearchResultEnhancerPort {
  /**
   * 先对每条结果用快速模型异步出摘要，再用教师模型做软推荐排序。
   * 任一模型不可用时应降级：摘要用截断原文、排名保持原顺序，不抛错。
   */
  enhance(results: { id: string; title: string; text: string }[]): Promise<SearchResultEnhancement[]>;
}

/** 按月归纳：把某个月的笔记（标题+片段）压成一段小结 */
export interface MonthlyDigestPort {
  summarizeMonth(notes: { title: string; content: string }[], yearMonth: string): Promise<string | undefined>;
}

export interface TodoDraft {
  title: string;
  description?: string;
  priority?: Priority;
  estimatedMinutes?: number;
  tags?: string[];
}

export interface ReviewDraft {
  content: string;
  summary?: string;
  insights: string[];
  nextTodos: string[];
  /** 生成时附带的目标日期（恢复崩溃前草稿时定位用） */
  date?: string;
  /** 生成时附带的复盘类型（恢复崩溃前草稿时定位用） */
  reviewType?: 'daily' | 'weekly' | 'monthly';
}

export interface TodoStructuringPort {
  /** 把自然语言目标拆解为 Todo 草稿 */
  structure(input: string): Promise<TodoDraft[]>;
}

export interface ReviewGeneratorPort {
  generate(input: {
    reviewType: 'daily' | 'weekly' | 'monthly';
    date: string;
    /** 区间内所有日期（含无数据日，evidence 按日分桶用） */
    dates?: string[];
    todos: Todo[];
    focusSessions: FocusSession[];
    /** 当日应用使用总分钟数（含专注），undefined=无记录 */
    usageMinutes?: number;
    /** 当日专注累计分钟数（来自使用时长记录，区别于 focusSessions 的完成口径） */
    focusUsageMinutes?: number;
    /** 每日 app 使用分钟（date → minutes），周/月 evidence 用 */
    usageByDate?: Map<string, number>;
    /** 已确认的知识链接摘要（程序生成，确定性文本），复盘可引用显式关系 */
    knowledgeSummary?: string;
  }): Promise<ReviewDraft>;
}

/** 宠物一句话的完整产出：文本 + 情绪（驱动动画）+ 意图（驱动下一步）+ 快捷回应 */
export interface CompanionUtterance {
  content: string;
  emotion?: 'calm' | 'curious' | 'happy' | 'concerned';
  intent?: 'acknowledge' | 'clarify' | 'suggest_one_step' | 'close';
  quickReplies?: string[];
}

export interface CompanionQuestionPort {
  generateQuestion(context: {
    scene: string;
    recentTodos: Todo[];
    recentFocusSessions: FocusSession[];
    /** 完整上下文摘要（时段/今日统计/最近轮次），模型据此说有关系的话（P1-5） */
    facts?: string;
    /** 最近台词（模型避免复述） */
    recentLines?: string[];
    /** 微型会话：当前轮次与上一轮用户语句（intent=clarify 时继续追问用） */
    conversationTurn?: number;
    recentUserStatement?: string;
  }): Promise<CompanionUtterance>;
  /** 反馈生成：带上宠物上一句问题和场景，模型才知道在回应什么（P1-6） */
  generateFeedback(context: {
    previousQuestion: string;
    userResponse: string;
    scene: string;
    /** 当前上下文摘要（当前任务等），让反馈贴住具体卡点 */
    facts?: string;
    /** 最近台词（模型避免复述） */
    recentLines?: string[];
    /** 微型会话：本轮序号（≥4 收束） */
    conversationTurn?: number;
  }): Promise<CompanionUtterance>;
  /** 主动调度（陪伴 agent）用：生成一句陪伴台词 */
  generateDialogue(context: { scene: string; facts?: string }): Promise<CompanionUtterance>;
}

export interface SocraticQuestionPort {
  askQuestion(input: {
    topic: string;
    history: SocraticExchange[];
  }): Promise<{ question: string; feedback?: string }>;
}

/* ---------- 文件解析与后台任务端口 ---------- */

export interface ParsedFile {
  title: string;
  content: string;
  sourceType: 'pdf' | 'markdown' | 'text';
  /** PDF 解析出的页范围，导入时存进笔记以便查看定位页码 */
  pageRanges?: NotePageRange[];
}

/**
 * 导入来源
 *
 * 必须显式区分「文件路径」和「直接给的文本」。
 * 之前两者都塞在一个 string 里，浏览器演示实现按文本处理、Tauri 实现按路径
 * 处理，同一个调用在两个环境下含义不同 —— 粘贴的正文在桌面端会被当成路径去
 * canonicalize，Windows 上直接报 os error 123。类型分开后这种歧义不可能再出现。
 */
export type ImportSource =
  | { kind: 'path'; path: string; tags?: string[] }
  | { kind: 'text'; content: string; title?: string; tags?: string[] };

export interface FileImportPort {
  parse(source: ImportSource): Promise<ParsedFile>;

  hash(content: string): Promise<string>;
}

export type JobType = 'parse_note' | 'chunk_note' | 'embed_chunks' | 'reindex_note' | 'rebuild_index';

export interface JobQueuePort {
  enqueue(job: { type: JobType; entityId: UUID; payload?: Record<string, unknown> }): Promise<void>;
}

/* ---------- 陪伴状态机端口 ---------- */

export type CompanionTrigger =
  | 'enter'
  | 'exit'
  | 'focus_start'
  | 'focus_complete'
  | 'focus_abort'
  | 'idle'
  | 'encourage'
  | 'user_initiated';

export interface CompanionStateMachinePort {
  transition(trigger: CompanionTrigger, payload?: unknown): Promise<void>;
}
