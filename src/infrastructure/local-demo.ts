import { createApplication, type Application } from '@application/bootstrap';
import { isSameLocalDay } from '@application/shared/utils';
import type { ActionProposal, ActionProposalRepository, ProposalStatus } from '@application/confirmation/action-proposal';
import type { ConfirmPrompt, ConfirmationPrompt } from '@application/confirmation/confirmation-service';
import type {
  AskSession,
  AskSessionRepository,
  AuditRepository,
  CompanionInteraction,
  DailyCheckIn,
  DailyCheckInRepository,
  Letter,
  LetterRepository,
  CompanionInteractionRepository,
  CompanionQuestionPort,
  CompanionStateMachinePort,
  FileImportPort,
  FocusRepository,
  FocusSession,
  ImportSource,
  JobQueuePort,

  JobType,
  KnowledgeLink,
  KnowledgeLinkQuery,
  KnowledgeLinkRepository,
  LinkEntityType,
  LinkRelationType,
  Note,

  MonthlyDigestPort,
  NoteRepository,
  NoteSearchPort,
  ParsedFile,
  ReviewDraft,
  ReviewGeneratorPort,
  ReviewLog,
  ReviewRepository,
  SearchHit,
  SearchResultEnhancement,
  SearchResultEnhancerPort,
  SocraticExchange,
  SocraticQuestionPort,
  SocraticRepository,
  SocraticSession,
  Todo,
  TodoDraft,
  TodoRepository,
  TodoStatus,
  TodoStructuringPort,
} from '@application/ports';
import type { ISO8601DateTime, UUID } from '@shared-types/common';
import { AudioPlayer } from './audio/audio-player';

const copy = <T>(value: T): T => structuredClone(value);
/** 本地日：UTC ISO 直接 slice 会错位（东八区凌晨归前一天），用本地时区换算 */
const dateOf = (timestamp?: ISO8601DateTime): string => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/* ---- 浏览器演示的本地持久化（localStorage），刷新/重启不丢；Tauri 走 SQLite 与此无关 ---- */

const saveMapEntries = <T>(key: string, source: Map<string, T>): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(source.entries())));
  } catch {
    // 写失败不影响内存态
  }
};

const loadMapEntries = <T>(key: string, target: Map<string, T>): void => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, T][];
    for (const [entryKey, value] of entries) target.set(entryKey, value);
  } catch {
    // localStorage 不可用则从空开始
  }
};

export class InMemoryTodoRepository implements TodoRepository {
  private readonly todos = new Map<UUID, Todo>();

  constructor() {
    loadMapEntries('nm.todos', this.todos);
  }

  async findById(id: UUID): Promise<Todo | null> {
    const todo = this.todos.get(id);
    return todo ? copy(todo) : null;
  }

  async findByDate(date: string): Promise<Todo[]> {
    return this.listAll().then((todos) =>
      todos.filter((todo) => todo.scheduledDate === date || (!todo.scheduledDate && dateOf(todo.createdAt) === date))
    );
  }

  async findByDateRange(from: string, to: string): Promise<Todo[]> {
    return this.listAll().then((todos) =>
      todos.filter((todo) => {
        if (todo.scheduledDate) return todo.scheduledDate >= from && todo.scheduledDate <= to;
        const day = dateOf(todo.createdAt);
        return day >= from && day <= to;
      })
    );
  }

  async findByStatus(status: TodoStatus, limit = 50): Promise<Todo[]> {
    return (await this.listAll()).filter((todo) => todo.status === status).slice(0, limit);
  }

  async save(todo: Todo): Promise<void> {
    this.todos.set(todo.id, copy(todo));
    saveMapEntries('nm.todos', this.todos);
  }

  async saveMany(todos: Todo[]): Promise<void> {
    todos.forEach((todo) => this.todos.set(todo.id, copy(todo)));
    saveMapEntries('nm.todos', this.todos);
  }

  async delete(id: string): Promise<void> {
    this.todos.delete(id);
    saveMapEntries('nm.todos', this.todos);
  }

  /** 事务化替换（内存版等价于先删后整批写，一次落盘） */
  async replaceAll(deleteId: UUID, todos: Todo[]): Promise<void> {
    this.todos.delete(deleteId);
    todos.forEach((todo) => this.todos.set(todo.id, copy(todo)));
    saveMapEntries('nm.todos', this.todos);
  }

  async listAll(): Promise<Todo[]> {
    return Array.from(this.todos.values())
      .map(copy)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

export class InMemoryFocusRepository implements FocusRepository {
  private readonly sessions = new Map<UUID, FocusSession>();

  constructor() {
    loadMapEntries('nm.focus', this.sessions);
  }

  async findById(id: UUID): Promise<FocusSession | null> {
    const session = this.sessions.get(id);
    return session ? copy(session) : null;
  }

  async findActive(): Promise<FocusSession | null> {
    const active = Array.from(this.sessions.values()).find((session) => session.status === 'active');
    return active ? copy(active) : null;
  }

  async abortStaleActive(maxAgeHours = 24): Promise<number> {
    const cutoff = Date.now() - maxAgeHours * 3_600_000;
    let removed = 0;
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && new Date(session.startedAt).getTime() < cutoff) {
        session.status = 'aborted';
        session.abortReason = '应用异常退出';
        removed += 1;
      }
    }
    return removed;
  }

  async findByDate(date: string): Promise<FocusSession[]> {
    return Array.from(this.sessions.values())
      .filter((session) => dateOf(session.startedAt) === date)
      .map(copy);
  }

  async findByDateRange(from: string, to: string): Promise<FocusSession[]> {
    return Array.from(this.sessions.values())
      .filter((session) => {
        const day = dateOf(session.startedAt);
        return day >= from && day <= to;
      })
      .map(copy);
  }

  async countAbortsByTodo(todoId: UUID, withinDays = 7): Promise<number> {
    const cutoff = Date.now() - withinDays * 86_400_000;
    return Array.from(this.sessions.values()).filter(
      (session) =>
        session.todoId === todoId &&
        session.status === 'aborted' &&
        new Date(session.startedAt).getTime() >= cutoff
    ).length;
  }

  async save(session: FocusSession): Promise<void> {
    this.sessions.set(session.id, copy(session));
    saveMapEntries('nm.focus', this.sessions);
  }

  async listAll(): Promise<FocusSession[]> {
    return Array.from(this.sessions.values())
      .map(copy)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }
}

export class InMemoryNoteRepository implements NoteRepository {
  private readonly notes = new Map<UUID, Note>();

  constructor() {
    loadMapEntries('nm.notes', this.notes);
  }

  async findById(id: UUID): Promise<Note | null> {
    const note = this.notes.get(id);
    return note ? copy(note) : null;
  }

  async findByContentHash(hash: string): Promise<Note | null> {
    const note = Array.from(this.notes.values()).find((item) => item.contentHash === hash);
    return note ? copy(note) : null;
  }

  async save(note: Note): Promise<void> {
    this.notes.set(note.id, copy(note));
    saveMapEntries('nm.notes', this.notes);
  }

  async delete(id: string): Promise<void> {
    this.notes.delete(id);
    saveMapEntries('nm.notes', this.notes);
  }

  async listAll(): Promise<Note[]> {
    return Array.from(this.notes.values())
      .map(copy)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly reviews = new Map<string, ReviewLog>();

  constructor() {
    loadMapEntries('nm.reviews', this.reviews);
  }

  async findById(id: string): Promise<ReviewLog | null> {
    const review = Array.from(this.reviews.values()).find((item) => item.id === id);
    return review ? copy(review) : null;
  }

  async findByDate(date: string, reviewType: 'daily' | 'weekly'): Promise<ReviewLog | null> {
    const review = this.reviews.get(`${reviewType}:${date}`);
    return review ? copy(review) : null;
  }

  async save(review: ReviewLog): Promise<void> {
    this.reviews.set(`${review.reviewType}:${review.date}`, copy(review));
    saveMapEntries('nm.reviews', this.reviews);
  }

  async listAll(): Promise<ReviewLog[]> {
    return Array.from(this.reviews.values())
      .map(copy)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async delete(id: string): Promise<void> {
    for (const [key, review] of this.reviews) {
      if (review.id === id) {
        this.reviews.delete(key);
        saveMapEntries('nm.reviews', this.reviews);
        return;
      }
    }
  }
}

export class InMemoryCompanionInteractionRepository implements CompanionInteractionRepository {
  private readonly interactions = new Map<UUID, CompanionInteraction>();

  async create(interaction: CompanionInteraction): Promise<CompanionInteraction> {
    this.interactions.set(interaction.id, copy(interaction));
    return copy(interaction);
  }

  async findById(id: UUID): Promise<CompanionInteraction | null> {
    const interaction = this.interactions.get(id);
    return interaction ? copy(interaction) : null;
  }

  async findLastQuestion(): Promise<CompanionInteraction | null> {
    const question = Array.from(this.interactions.values())
      .filter((interaction) => interaction.interactionType === 'question')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return question ? copy(question) : null;
  }

  async findLast(): Promise<CompanionInteraction | null> {
    const last = Array.from(this.interactions.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return last ? copy(last) : null;
  }

  async countTodayQuestions(): Promise<number> {
    return Array.from(this.interactions.values()).filter(
      (interaction) => interaction.interactionType === 'question' && isSameLocalDay(interaction.createdAt)
    ).length;
  }

  async countTodayByScene(scene: string): Promise<number> {
    return Array.from(this.interactions.values()).filter(
      (interaction) => interaction.sceneType === scene && isSameLocalDay(interaction.createdAt)
    ).length;
  }

  async updateResponse(id: UUID, response: string): Promise<void> {
    const interaction = this.interactions.get(id);
    if (!interaction) return;
    this.interactions.set(id, { ...interaction, userResponse: response, requiresResponse: false });
  }

  async listAll(): Promise<CompanionInteraction[]> {
    return Array.from(this.interactions.values())
      .map(copy)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

export class InMemorySocraticRepository implements SocraticRepository {
  private readonly sessions = new Map<UUID, SocraticSession>();
  private readonly exchanges = new Map<UUID, SocraticExchange>();

  async saveSession(session: SocraticSession): Promise<void> {
    this.sessions.set(session.id, copy(session));
  }

  async findSession(id: UUID): Promise<SocraticSession | null> {
    const session = this.sessions.get(id);
    return session ? copy(session) : null;
  }

  /** 排序与 SQLite 侧一致：最近更新的在前 */
  async listSessions(limit = 50): Promise<SocraticSession[]> {
    return Array.from(this.sessions.values())
      .map(copy)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }


  async saveExchange(exchange: SocraticExchange): Promise<void> {
    this.exchanges.set(exchange.id, copy(exchange));
  }

  async countExchanges(sessionId: UUID): Promise<number> {
    return Array.from(this.exchanges.values()).filter((exchange) => exchange.sessionId === sessionId).length;
  }

  async listExchanges(sessionId: UUID): Promise<SocraticExchange[]> {
    return Array.from(this.exchanges.values())
      .filter((exchange) => exchange.sessionId === sessionId)
      .map(copy)
      .sort((left, right) => left.turnNumber - right.turnNumber);
  }
}

/* ---------- 每日打卡 ---------- */

export class InMemoryDailyCheckInRepository implements DailyCheckInRepository {
  private readonly records = new Map<string, DailyCheckIn>();

  async save(checkIn: DailyCheckIn): Promise<void> {
    this.records.set(checkIn.date, copy(checkIn));
  }

  async get(date: string): Promise<DailyCheckIn | null> {
    const record = this.records.get(date);
    return record ? copy(record) : null;
  }

  async listMonth(yearMonth: string): Promise<DailyCheckIn[]> {
    return Array.from(this.records.values())
      .filter((record) => record.date.startsWith(`${yearMonth}-`))
      .map(copy)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

/* ---------- Flora 信件 ---------- */

export class InMemoryLetterRepository implements LetterRepository {
  private readonly records = new Map<string, Letter>();

  async save(letter: Letter): Promise<void> {
    this.records.set(letter.id, copy(letter));
  }

  async list(limit = 50): Promise<Letter[]> {
    return Array.from(this.records.values())
      .map(copy)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listPendingDue(nowIso: string): Promise<Letter[]> {
    return Array.from(this.records.values())
      .filter((letter) => letter.status === 'pending' && letter.sendAfter <= nowIso)
      .map(copy)
      .sort((a, b) => a.sendAfter.localeCompare(b.sendAfter));
  }

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.records.delete(id)) deleted += 1;
    }
    return deleted;
  }
}

/* ---------- 深度问答历史 ---------- */

export class InMemoryAskSessionRepository implements AskSessionRepository {
  private readonly sessions = new Map<string, AskSession>();

  async save(session: AskSession): Promise<void> {
    this.sessions.set(session.id, copy(session));
  }

  async list(limit = 50): Promise<AskSession[]> {
    return Array.from(this.sessions.values())
      .map(copy)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }
}

/**
 * 内存版知识链接仓储
 *
 * 语义与 SqliteKnowledgeLinkRepository 对齐，尤其是这两条 ——
 * 否则 demo 环境下的行为会和生产不一致，测出来的结论不可信：
 * - 同一条边（起点 + 终点 + 关系类型）唯一，重复保存是更新而非追加
 * - 删除走归档，查询默认排除已归档
 */
export class InMemoryKnowledgeLinkRepository implements KnowledgeLinkRepository {
  private readonly links = new Map<UUID, KnowledgeLink>();

  /** 与 SQLite 侧唯一索引对应的键 */
  private static edgeKey(edge: {
    fromType: LinkEntityType;
    fromId: UUID;
    toType: LinkEntityType;
    toId: UUID;
    relationType: LinkRelationType;
  }): string {
    return `${edge.fromType}:${edge.fromId}→${edge.toType}:${edge.toId}#${edge.relationType}`;
  }

  async findById(id: UUID): Promise<KnowledgeLink | null> {
    const link = this.links.get(id);
    return link ? copy(link) : null;
  }

  async query(query: KnowledgeLinkQuery): Promise<KnowledgeLink[]> {
    const relationFilter = query.relationTypes?.length ? new Set(query.relationTypes) : undefined;

    return Array.from(this.links.values())
      .filter((link) => {
        if (!query.includeArchived && link.archivedAt) return false;
        if (query.onlyConfirmed && !link.confirmedByUser) return false;
        if (relationFilter && !relationFilter.has(link.relationType)) return false;

        if (query.entity) {
          const { type, id } = query.entity;
          const touches =
            (link.fromType === type && link.fromId === id) || (link.toType === type && link.toId === id);
          if (!touches) return false;
        }
        return true;
      })
      .map(copy)
      .sort((left, right) => {
        // 与 SQL 的 ORDER BY 一致：已确认 → 置信度 → 创建时间
        if (left.confirmedByUser !== right.confirmedByUser) return left.confirmedByUser ? -1 : 1;
        const confidenceDiff = (right.confidence ?? 0) - (left.confidence ?? 0);
        if (confidenceDiff !== 0) return confidenceDiff;
        return right.createdAt.localeCompare(left.createdAt);
      })
      .slice(0, query.limit ?? 200);
  }

  async findEdge(edge: {
    fromType: LinkEntityType;
    fromId: UUID;
    toType: LinkEntityType;
    toId: UUID;
    relationType: LinkRelationType;
  }): Promise<KnowledgeLink | null> {
    const key = InMemoryKnowledgeLinkRepository.edgeKey(edge);
    const found = Array.from(this.links.values()).find(
      (link) => InMemoryKnowledgeLinkRepository.edgeKey(link) === key
    );
    return found ? copy(found) : null;
  }

  async save(link: KnowledgeLink): Promise<void> {
    // 模拟唯一索引：同一条边已存在于别的 id 下时，删掉旧的那行
    const key = InMemoryKnowledgeLinkRepository.edgeKey(link);
    for (const [id, existing] of this.links) {
      if (id !== link.id && InMemoryKnowledgeLinkRepository.edgeKey(existing) === key) {
        this.links.delete(id);
      }
    }
    this.links.set(link.id, copy(link));
  }

  async archive(id: UUID, archivedAt: ISO8601DateTime): Promise<void> {
    const link = this.links.get(id);
    if (!link) return;
    this.links.set(id, { ...link, archivedAt, updatedAt: archivedAt });
  }

  async restore(id: UUID, updatedAt: ISO8601DateTime): Promise<void> {
    const link = this.links.get(id);
    if (!link) return;
    const restored = { ...link, updatedAt };
    delete restored.archivedAt;
    this.links.set(id, restored);
  }

  async listAll(): Promise<KnowledgeLink[]> {
    return this.query({});
  }
}

export class InMemoryActionProposalRepository implements ActionProposalRepository {

  private readonly proposals = new Map<UUID, ActionProposal>();

  async save(proposal: ActionProposal): Promise<void> {
    this.proposals.set(proposal.id, copy(proposal));
  }

  async findById(id: UUID): Promise<ActionProposal | null> {
    const proposal = this.proposals.get(id);
    return proposal ? copy(proposal) : null;
  }

  async updateStatus(id: UUID, status: ProposalStatus, decidedAt: ISO8601DateTime): Promise<void> {
    const proposal = this.proposals.get(id);
    if (!proposal) return;
    this.proposals.set(id, { ...proposal, status, decidedAt });
  }
}

export interface AuditEntry {
  eventType: string;
  payload: unknown;
  timestamp: ISO8601DateTime;
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditEntry[] = [];

  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(copy(entry));
  }

  async listAll(): Promise<AuditEntry[]> {
    return this.entries.map(copy);
  }
}

export interface QueuedJob {
  type: JobType;
  entityId: UUID;
  payload?: Record<string, unknown>;
}

export class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs: QueuedJob[] = [];

  async enqueue(job: QueuedJob): Promise<void> {
    this.jobs.push(copy(job));
  }

  async listAll(): Promise<QueuedJob[]> {
    return this.jobs.map(copy);
  }
}

/**
 * 浏览器演示用的导入实现。
 *
 * 只支持 text 来源：浏览器里没有可读的本地文件系统，遇到 path 必须明确报错，
 * 而不是把路径字符串当正文存进去 —— 那会产生一条内容是路径的假笔记。
 */
export class LocalTextFileImport implements FileImportPort {
  async parse(source: ImportSource): Promise<ParsedFile> {
    if (source.kind === 'path') {
      throw new Error('浏览器演示模式不能读本地文件，请粘贴内容或使用桌面版');
    }

    const content = source.content.trim();
    const firstLine = content.split(/\r?\n/).find((line) => line.trim());
    const title =
      source.title?.trim() || firstLine?.replace(/^#+\s*/, '').slice(0, 80) || 'Untitled note';
    const sourceType = firstLine?.startsWith('#') ? 'markdown' : 'text';
    return { title, content, sourceType };
  }


  async hash(content: string): Promise<string> {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(content);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return `sha256:${hex}`;
    }

    let hash = 0;
    for (let index = 0; index < content.length; index += 1) {
      hash = Math.imul(31, hash) + content.charCodeAt(index);
    }
    return `fallback:${hash >>> 0}`;
  }
}

export class InMemoryCompanionStateMachine implements CompanionStateMachinePort {
  private currentTrigger = 'idle';

  async transition(trigger: string): Promise<void> {
    this.currentTrigger = trigger;
  }

  get current(): string {
    return this.currentTrigger;
  }
}

export class RuleBasedTodoStructuringPort implements TodoStructuringPort {
  async structure(input: string): Promise<TodoDraft[]> {
    const clean = input.trim();
    if (!clean) return [];

    const parts = clean
      .split(/[;；。.\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 5);

    return (parts.length > 0 ? parts : [clean]).map((title) => ({
      title,
      priority: 'medium',
      estimatedMinutes: 25,
      tags: ['today'],
    }));
  }
}

export class TemplateReviewGeneratorPort implements ReviewGeneratorPort {
  async generate(input: {
    reviewType: 'daily' | 'weekly';
    date: string;
    todos: Todo[];
    focusSessions: FocusSession[];
  }): Promise<ReviewDraft> {
    const completedTodos = input.todos.filter((todo) => todo.status === 'completed');
    const completedFocus = input.focusSessions.filter((session) => session.status === 'completed');
    const focusMinutes = completedFocus.reduce((sum, session) => sum + session.durationMinutes, 0);
    const label = input.reviewType === 'daily' ? 'Daily' : 'Weekly';

    return {
      content: [
        `# ${label} review - ${input.date}`,
        '',
        `Completed tasks: ${completedTodos.length}/${input.todos.length}.`,
        `Completed focus time: ${focusMinutes} minutes.`,
        '',
        'Notes:',
        '- Add a short reflection after the session.',
      ].join('\n'),
      summary: `${completedTodos.length} tasks completed, ${focusMinutes} focused minutes.`,
      insights: focusMinutes > 0 ? ['Focus data is available for review.'] : ['No completed focus sessions yet.'],
      nextTodos: input.todos
        .filter((todo) => todo.status !== 'completed')
        .slice(0, 3)
        .map((todo) => todo.title),
    };
  }
}

export class TemplateCompanionQuestionPort implements CompanionQuestionPort {
  async generateQuestion(context: { scene: string }): Promise<string> {
    if (context.scene === 'focus_complete') return 'Nice finish. Want to jot down one sentence about what moved?';
    if (context.scene === 'repeatedly_aborted') return 'Would a smaller next step make this easier to restart?';
    return 'What is the next small thing worth doing?';
  }

  async generateFeedback(response: string): Promise<string> {
    return response.trim() ? 'Saved. Keep it concrete and light.' : 'No worries. We can leave it blank for now.';
  }

  async generateDialogue(context: { scene: string; facts?: string }): Promise<string> {
    return context.facts ? `今天也辛苦了（${context.facts}）。` : '今天也辛苦了，要歇一会儿吗？';
  }
}

export class TemplateSocraticQuestionPort implements SocraticQuestionPort {
  async askQuestion(input: {
    topic: string;
    history: SocraticExchange[];
  }): Promise<{ question: string; feedback?: string }> {
    const turn = input.history.length + 1;
    if (turn === 1) return { question: `What do you already know about ${input.topic}?` };
    return {
      feedback: 'Good. Try connecting that answer to a concrete example.',
      question: `What assumption in your current understanding of ${input.topic} should we test next?`,
    };
  }
}

export class LocalNoteSearchPort implements NoteSearchPort {
  constructor(private readonly noteRepo: InMemoryNoteRepository) {}

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    if (terms.length === 0) return [];

    const notes = await this.noteRepo.listAll();
    return notes
      .map((note) => {
        const haystack = `${note.title}\n${note.content}`.toLowerCase();
        const matches = terms.filter((term) => haystack.includes(term)).length;
        return {
          chunkId: note.id,
          noteId: note.id,
          text: note.content.slice(0, 240),
          score: matches / terms.length,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

/** 模板搜索整理：无模型，摘要用截断原文、排名保持原顺序 */
export class TemplateSearchResultEnhancerPort implements SearchResultEnhancerPort {
  async enhance(
    results: { id: string; title: string; text: string }[]
  ): Promise<SearchResultEnhancement[]> {
    return results.map((result, index) => ({
      id: result.id,
      summary: result.text.replace(/\s+/g, ' ').trim().slice(0, 40),
      rank: index + 1,
      reason: undefined,
    }));
  }
}

/** 模板月度归纳：无模型，只列标题（演示模式） */
export class TemplateMonthlyDigestPort implements MonthlyDigestPort {
  async summarizeMonth(
    notes: { title: string; content: string }[],
    yearMonth: string
  ): Promise<string | undefined> {
    if (notes.length === 0) return undefined;
    const titles = notes
      .slice(0, 20)
      .map((note) => note.title || '（无标题）')
      .join('、');
    return `${yearMonth} 共 ${notes.length} 篇笔记：${titles}（演示模式无模型，仅列出标题）。`;
  }
}

/**
 * 浏览器演示用的设置仓储（localStorage 持久化）
 *
 * 接口与 SqliteSettingsRepository 一致，让设置 store 在无 Tauri 环境下也能跑；
 * 并落 localStorage，刷新/重启后设置不丢。Tauri 走 SQLite 与此无关。
 */
const SETTINGS_STORAGE_KEY = 'nativemind.web-settings.v1';

export class InMemorySettingsRepository {
  private readonly values = new Map<string, string>();

  constructor() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') this.values.set(key, value);
        }
      }
    } catch {
      // localStorage 不可用则从空开始，仅本次会话有效
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.values)),
      );
    } catch {
      // 写失败不影响内存态
    }
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.persist();
  }

  async setMany(entries: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.values.set(key, value);
    }
    this.persist();
  }

  async getAll(): Promise<Record<string, string>> {
    return Object.fromEntries(this.values);
  }
}

export interface LocalDemoRuntime {
  application: Application;
  /**
   * 当前 AI 能力来源。demo 恒为 template：
   * 这里的「AI」只是字符串切分与模板填空，不接任何模型。
   * UI 据此明确告知用户，而不是让人以为模型在工作。
   */
  aiMode: 'template';
  /** 与 Tauri AILayer 同形（ports 是模板实现），UI 统一经 ai.ports.noteDigest 访问 */
  ai: { ports: { noteDigest: TemplateMonthlyDigestPort } };
  repositories: {
    todo: InMemoryTodoRepository;
    focus: InMemoryFocusRepository;
    note: InMemoryNoteRepository;
    review: InMemoryReviewRepository;
    companionInteraction: InMemoryCompanionInteractionRepository;
    socratic: InMemorySocraticRepository;
    knowledgeLink: InMemoryKnowledgeLinkRepository;
    actionProposal: InMemoryActionProposalRepository;
    audit: InMemoryAuditRepository;
    ask: InMemoryAskSessionRepository;
    checkIn: InMemoryDailyCheckInRepository;
    letter: InMemoryLetterRepository;
    settings: InMemorySettingsRepository;
  };


  infrastructure: {
    fileImport: LocalTextFileImport;
    jobQueue: InMemoryJobQueue;
    companionStateMachine: InMemoryCompanionStateMachine;
    /** 网页端也能播 public/ 下的占位音频，浏览器用 HTML Audio 播放 */
    audioPlayer: AudioPlayer;
  };
}

export interface LocalDemoOptions {
  /** UI 侧确认入口。缺省一律拒绝，保证无人值守时不会静默写库 */
  confirmationPrompt?: ConfirmationPrompt;
  /** UI 侧简单确认入口（删除等破坏性操作）。缺省一律拒绝 */
  confirmPrompt?: ConfirmPrompt;
}

export const createLocalDemoRuntime = (options: LocalDemoOptions = {}): LocalDemoRuntime => {
  const todo = new InMemoryTodoRepository();
  const focus = new InMemoryFocusRepository();
  const note = new InMemoryNoteRepository();
  const review = new InMemoryReviewRepository();
  const companionInteraction = new InMemoryCompanionInteractionRepository();
  const socratic = new InMemorySocraticRepository();
  const knowledgeLink = new InMemoryKnowledgeLinkRepository();
  const actionProposal = new InMemoryActionProposalRepository();
  const audit = new InMemoryAuditRepository();
  const ask = new InMemoryAskSessionRepository();
  const checkIn = new InMemoryDailyCheckInRepository();
  const letter = new InMemoryLetterRepository();


  const settings = new InMemorySettingsRepository();

  const fileImport = new LocalTextFileImport();
  const jobQueue = new InMemoryJobQueue();
  const companionStateMachine = new InMemoryCompanionStateMachine();
  const audioPlayer = new AudioPlayer();

  // 与 AILayer.ports 同形的 AI 能力集合（web 模板实现）
  const aiPorts = {
    todoStructuring: new RuleBasedTodoStructuringPort(),
    reviewGenerator: new TemplateReviewGeneratorPort(),
    companionQuestion: new TemplateCompanionQuestionPort(),
    socraticQuestion: new TemplateSocraticQuestionPort(),
    noteSearch: new LocalNoteSearchPort(note),
    // 模板 AI 无法判断关系，demo 环境一律不产出建议
    suggestionPort: { suggestForNote: async () => [] },
    searchResultEnhancer: new TemplateSearchResultEnhancerPort(),
    noteDigest: new TemplateMonthlyDigestPort(),
    // 模板 AI 没有生成能力，深度问答返回空（UI 提示换问法）
    askNotes: {
      ask: async () => ({
        answer: '',
        citations: [],
        confidence: 0,
        judged: false,
        regenerated: false,
        empty: true,
        ok: false,
      }),
    },
  };

  const application = createApplication({

    repositories: {
      todo,
      focus,
      note,
      review,
      companionInteraction,
      socratic,
      knowledgeLink,
      audit,
      actionProposal,
      ask,
      checkIn,
      letter,
      settings,
    },
    ai: aiPorts,
    infrastructure: {
      fileImport,
      jobQueue,
      companionStateMachine,
    },
    confirmationPrompt: options.confirmationPrompt ?? (async () => false),
    confirmPrompt: options.confirmPrompt,
  });

  return {
    application,
    aiMode: 'template',
    // 与 Tauri 的 AILayer 同形：UI 通过 ai.ports.noteDigest 访问
    ai: { ports: aiPorts },
    repositories: {
      todo,
      focus,
      note,
      review,
      companionInteraction,
      socratic,
      knowledgeLink,
      actionProposal,
      audit,
      ask,
      checkIn,
      letter,
      settings,
    },


    infrastructure: {
      fileImport,
      jobQueue,
      companionStateMachine,
      audioPlayer,
    },
  };
};
