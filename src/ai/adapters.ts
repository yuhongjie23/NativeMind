/**
 * 端口适配器 - AI 层 → application 层接口的对接
 *
 * application 定义接口，本层实现（C2 依赖单向）。用例只认这些接口，
 * 因此换模型、换 Prompt、换 RAG 策略都不会波及用例代码。
 *
 * 降级约定（§16.1）：
 * - 草稿类（Todo / 关系建议）失败 → 返回空，用例自然走「用户手动填写」
 * - 复盘失败 → 返回只含统计数字的骨架草稿，用户自己写内容，比报错好用
 * - 交互类（苏格拉底 / 陪伴）失败 → 陪伴用模板兜底；苏格拉底抛 ModelUnavailableError，
 *   由 UI 提示「当前功能需要本地模型」
 */
import type {
  AskNotesAnswer,
  AskNotesPort,
  AskNotesQuestion,
  CompanionQuestionPort,
  CompanionUtterance,
  FloraLanguage,
  FloraPort,
  FloraReply,
  FocusSession,
  KnowledgeLinkSuggestionPort,
  LinkSuggestionCandidate,
  MonthlyDigestPort,
  NoteSearchPort,
  ReviewDraft,
  ReviewGeneratorPort,
  SearchHit,
  SearchResultEnhancement,
  SearchResultEnhancerPort,
  SocraticExchange,
  SocraticQuestionPort,
  Todo,
  TodoDraft,
  TodoStructuringPort,
} from '@application/ports';
import type { UUID } from '@shared-types/common';
import { InteractionGenerator, type CompanionScene } from './companion/interaction-generator';
import type { FloraAgent } from './flora/flora-agent';
import type { RAGOrchestrator } from './rag/rag-orchestrator';
import type { SelfRag } from './rag/self-rag';
import { buildReviewEvidence } from './rag/review-evidence';
import type { ModelRouter } from './router/model-router';
import { truncate } from './shared/utils';

/** 模型未安装 / 显存不足。UI 应提示安装指南，不当成崩溃处理 */
export class ModelUnavailableError extends Error {
  constructor(feature: string) {
    super(`${feature}需要本地模型，请在设置中检查模型状态`);
    this.name = 'ModelUnavailableError';
  }
}

/* ---------- Todo 拆解 ---------- */

/** 今日任务时长预算，超出会让「只做今天做得完的事」失效 */
const DAILY_BUDGET_MINUTES = 120;

export class TodoStructuringAdapter implements TodoStructuringPort {
  constructor(
    private readonly router: ModelRouter,
    /** 可选：带上相关旧笔记，帮模型复用已有标签、找准起点 */
    private readonly rag?: RAGOrchestrator
  ) {}

  async structure(input: string): Promise<TodoDraft[]> {
    const relatedNotes = await this.collectRelatedNotes(input);

    const result = await this.router.run<{ goal: string }, TodoDraft[]>({
      taskType: 'todo_structuring',
      input: { goal: input },
      promptVars: {
        goal: input,
        relatedNotes: relatedNotes || '（无）',
        dailyBudgetMinutes: DAILY_BUDGET_MINUTES,
      },
    });

    // 失败返回空数组，CreateTodoUseCase 会直接结束，用户可手动新建
    return result.output ?? [];
  }

  private async collectRelatedNotes(goal: string): Promise<string> {
    if (!this.rag) return '';
    try {
      const candidates = await this.rag.retrieve({ text: goal }, 3);
      return candidates.map((c) => `- ${truncate(c.text, 150)}`).join('\n');
    } catch (error) {
      console.warn('[TodoStructuringAdapter] 检索相关笔记失败，跳过:', error);
      return '';
    }
  }
}

/* ---------- 复盘生成 ---------- */

export class ReviewGeneratorAdapter implements ReviewGeneratorPort {
  constructor(private readonly router: ModelRouter) {}

  async generate(input: {
    reviewType: 'daily' | 'weekly' | 'monthly';
    date: string;
    dates?: string[];
    todos: Todo[];
    focusSessions: FocusSession[];
    usageMinutes?: number;
    focusUsageMinutes?: number;
    usageByDate?: Map<string, number>;
    knowledgeSummary?: string;
  }): Promise<ReviewDraft> {
    // 证据构建：按日分桶 + 程序计算趋势/信号，模型只做语言组织。
    // 周/月用完整证据文本（每日明细+信号）；日复盘也用同一构建器（单日）。
    const usageByDate =
      input.usageByDate ??
      (input.usageMinutes !== undefined
        ? new Map([[input.date, input.usageMinutes]])
        : new Map());
    const evidence = buildReviewEvidence({
      reviewType: input.reviewType,
      dates: input.dates ?? [input.date],
      todos: input.todos,
      focusSessions: input.focusSessions,
      usageByDate,
    });
    const evidenceText = evidence.text;
    // 使用时长覆盖度：避免「无记录」被解释成「没使用」
    const usageSummary =
      input.usageMinutes !== undefined
        ? `应用使用约 ${input.usageMinutes} 分钟（覆盖 ${evidence.coverage.usageRecordedDays}/${evidence.period.expectedDays} 天），其中专注 ${input.focusUsageMinutes ?? 0} 分钟`
        : '（无使用时长记录——仅表示未采集，不代表未使用）';

    const result = await this.router.run<typeof input, ReviewDraft>({
      // 日复盘走 coach 层，周/月复盘走 deep 层（14B），由路由表决定。
      // 之前把 monthly 落进 daily 分支，生成内容与时间窗都是「当日复盘」。
      taskType:
        input.reviewType === 'weekly'
          ? 'review_weekly'
          : input.reviewType === 'monthly'
            ? 'review_monthly'
            : 'review_daily',
      input,
      promptVars: {
        reviewType:
          input.reviewType === 'weekly'
            ? '周复盘'
            : input.reviewType === 'monthly'
              ? '月度复盘'
              : '日复盘',
        dateRange:
          input.reviewType === 'weekly'
            ? `截至 ${input.date} 的 7 天`
            : input.reviewType === 'monthly'
              ? `截至 ${input.date} 的 30 天`
              : input.date,
        // 数字与趋势由程序计算，模型只负责选重点和表达——长度收紧，
        // 避免 14B 在长正文 + JSON 转义下输出重复/截断
        contentLength:
          input.reviewType === 'monthly'
            ? '500 到 900 字'
            : input.reviewType === 'weekly'
              ? '300 到 600 字'
              : '120 到 250 字',
        evidence: evidenceText,
        usageSummary,
        // 已确认的知识链接摘要（程序生成）：复盘可引用显式关系，如「QLoRA 是 LoRA 的延伸」
        knowledgeSummary: input.knowledgeSummary ?? '（无已确认的知识关联）',
        todoSummary: '',
        focusSummary: '',
      },
    });

    if (result.output) return result.output;

    // 降级：给出事实骨架，让用户自己写。比抛错强，用户至少不用重新翻数据。
    // 带上失败原因 —— 否则用户只看到「模型未生成」，无从判断是模型没装、
    // 输出格式不对还是超时，也没法据此去设置页排查。
    const reason = result.error ? `${result.error.kind}: ${result.error.message}` : '未知原因';
    console.warn('[ReviewGenerator] 模型未产出可用草稿，已降级为数据摘要：', reason);

    return {
      content: [
        `${input.date} 数据摘要`,
        `（AI 未能生成复盘正文，原因：${reason}。下面是程序整理的学习数据，可直接在此基础上自己写。）`,
        '',
        evidenceText,
      ].join('\n'),
      summary: undefined,
      insights: [],
      nextTodos: [],
    };

  }
}

/* ---------- 陪伴角色 ---------- */

/** application 传来的场景名 → 生成器的场景枚举 */
const SCENE_MAP: Record<string, CompanionScene> = {
  app_entered: 'app_entered',
  // UI 传 enter（AppEntered 事件），必须映射到 app_entered，否则落到 feedback「记下了」
  enter: 'app_entered',
  focus_start: 'focus_start',
  focus_complete: 'focus_complete',
  focus_abort: 'focus_abort',
  repeatedly_aborted: 'repeatedly_aborted',
  review_generated: 'review_generated',
  app_exiting: 'app_exiting',
  // 用户点宠物：随机互动（问候/关心/轻问题），关键：不能落到 feedback 否则回退成「记下了」
  user_invoked: 'user_invoked',
  // 主动调度（陪伴 agent）意图 → 借用语气最接近的既有场景
  idle_checkin: 'app_entered',
  stuck_encourage: 'repeatedly_aborted',
  milestone_celebrate: 'focus_complete',
};

export class CompanionQuestionAdapter implements CompanionQuestionPort {
  constructor(private readonly generator: InteractionGenerator) {}

  async generateQuestion(context: {
    scene: string;
    recentTodos: Todo[];
    recentFocusSessions: FocusSession[];
    facts?: string;
    recentLines?: string[];
    conversationTurn?: number;
    recentUserStatement?: string;
  }): Promise<CompanionUtterance> {
    const facts = [
      context.facts,
      context.recentTodos.length > 0
        ? `最近任务：${context.recentTodos.slice(0, 3).map((t) => t.title).join('、')}`
        : '',
      context.recentFocusSessions.length > 0
        ? `最近专注 ${context.recentFocusSessions.length} 段`
        : '',
      context.conversationTurn !== undefined ? `当前对话轮次：${context.conversationTurn}` : '',
      context.recentUserStatement ? `用户刚才说：${context.recentUserStatement}` : '',
    ]
      .filter(Boolean)
      .join('；');

    return this.generator.generateQuestion({
      scene: SCENE_MAP[context.scene] ?? 'feedback',
      facts: facts || undefined,
      recentLines: context.recentLines,
    });
  }

  async generateFeedback(context: {
    previousQuestion: string;
    userResponse: string;
    scene: string;
    facts?: string;
    recentLines?: string[];
    conversationTurn?: number;
  }): Promise<CompanionUtterance> {
    return this.generator.generateFeedback(context);
  }

  async generateDialogue(context: { scene: string; facts?: string }): Promise<CompanionUtterance> {
    return this.generator.generateDialogue({
      scene: SCENE_MAP[context.scene] ?? 'feedback',
      facts: context.facts,
    });
  }
}

/* ---------- 苏格拉底提问 ---------- */

const MAX_HISTORY_TURNS = 6;

const formatHistory = (history: SocraticExchange[]): string => {
  if (history.length === 0) return '（这是第一轮）';
  return history
    .slice(-MAX_HISTORY_TURNS)
    .map((e) => `Q${e.turnNumber}: ${e.question}\nA${e.turnNumber}: ${e.userResponse ?? '（未回答）'}`)
    .join('\n');
};

export class SocraticQuestionAdapter implements SocraticQuestionPort {
  constructor(
    private readonly router: ModelRouter,
    private readonly rag?: RAGOrchestrator
  ) {}

  async askQuestion(input: {
    topic: string;
    history: SocraticExchange[];
  }): Promise<{ question: string; feedback?: string }> {
    const last = input.history[input.history.length - 1];
    const relatedNotes = await this.collectRelatedNotes(input.topic);

    const result = await this.router.run<typeof input, string>({
      taskType: 'socratic_question',
      input,
      promptVars: {
        topic: input.topic,
        history: formatHistory(input.history),
        relatedNotes: relatedNotes || '（无）',
        // fillTemplate 只替换 {{word}}，不支持 Mustache 条件块：把「先回应上一轮再提问」
        // 的完整指令直接作为 feedbackHint 值传进去，避免模板里出现没被替换的字面量
        feedbackHint: last?.userResponse
          ? `上一轮回答：${truncate(last.userResponse, 120)}\n先简短回应这轮回答里值得点出的地方，再提出下一个问题（总共不超过 100 字）。`
          : '直接提出下一个要讨论的问题（总共不超过 100 字）。',
      },
    });

    // 这是交互式功能，没有合理的兜底内容，交由 UI 提示降级
    if (!result.output) throw new ModelUnavailableError('苏格拉底式提问');
    return { question: result.output };
  }

  private async collectRelatedNotes(topic: string): Promise<string> {
    if (!this.rag) return '';
    try {
      const candidates = await this.rag.retrieve({ text: topic }, 3);
      return candidates.map((c) => `- ${truncate(c.text, 200)}`).join('\n');
    } catch (error) {
      console.warn('[SocraticQuestionAdapter] 检索相关笔记失败，跳过:', error);
      return '';
    }
  }
}

/* ---------- 本地笔记检索 ---------- */

export class NoteSearchAdapter implements NoteSearchPort {
  constructor(private readonly rag: RAGOrchestrator) {}

  async search(query: string, limit: number, deep?: boolean): Promise<SearchHit[]> {
    const candidates = await this.rag.retrieve({ text: query, deep }, limit);
    return candidates.map((c) => ({
      chunkId: c.chunkId,
      noteId: c.noteId,
      text: c.text,
      score: c.score,
      headingPath: c.headingPath,
      charStart: c.charStart,
    }));
  }
}

/* ---------- 搜索结果整理：快速摘要 + 教师软推荐 ---------- */

/** 一句摘要的长度上限，超了就截断，避免小模型把话讲太长 */
const SUMMARY_MAX = 40;

export class SearchResultEnhancerAdapter implements SearchResultEnhancerPort {
  constructor(private readonly router: ModelRouter) {}

  async enhance(
    results: { id: string; title: string; text: string }[]
  ): Promise<SearchResultEnhancement[]> {
    if (results.length === 0) return [];

    // 1) 快速模型逐条摘要；单条失败只影响该条（降级为截断原文）。
    //    分批并发（每批 4 条）而不是一次性全发：本地 Ollama 扛不住几十路并发，
    //    大结果集会互相排队把显存/队列打爆
    const summarized: { id: string; title: string; text: string; summary: string }[] = [];
    const BATCH = 4;
    for (let start = 0; start < results.length; start += BATCH) {
      const batch = results.slice(start, start + BATCH);
      const done = await Promise.all(
        batch.map(async (item) => ({
          ...item,
          summary: await this.summarize(item.text),
        }))
      );
      summarized.push(...done);
    }

    // 2) 教师模型软推荐排序 + 理由；失败保持原顺序
    const ranked = await this.rank(summarized);

    return summarized.map((item, index) => {
      const entry = ranked.get(item.id);
      return {
        id: item.id,
        summary: item.summary,
        rank: entry?.rank ?? index + 1,
        reason: entry?.reason,
      };
    });
  }

  private async summarize(text: string): Promise<string> {
    const result = await this.router.run<{ text: string }, string>({
      taskType: 'light_summary',
      input: { text },
      inlinePrompt: {
        system: '你是学习笔记整理助手。用一句话、不超过 30 个字，抓住内容核心要点。只输出摘要本身，不要引号。',
        user: `请给下面内容写一句核心摘要（≤30 字）：\n\n${truncate(text, 800)}`,
      },
    });
    if (result.output && result.output.trim()) return result.output.trim();
    return truncate(text.replace(/\s+/g, ' '), SUMMARY_MAX);
  }

  private async rank(
    items: { id: string; title: string; text: string; summary: string }[]
  ): Promise<Map<string, { rank: number; reason?: string }>> {
    const out = new Map<string, { rank: number; reason?: string }>();
    const fallback = items.map((item, index) => ({ id: item.id, rank: index + 1 }));
    if (items.length < 2) {
      fallback.forEach((entry) => out.set(entry.id, entry));
      return out;
    }

    const list = items
      .map((item, index) => `${index}. ${item.title || '结果'}\n摘要：${item.summary}`)
      .join('\n\n');

    const result = await this.router.run<
      { items: unknown },
      { index: number; reason?: string }[]
    >({
      taskType: 'search_result_ranking',
      input: { items },
      inlinePrompt: {
        system: '你是学习教练。根据候选结果，按「对学习最有帮助」从高到低软推荐排序，并给一句简短理由。只输出 JSON 数组。',
        user: `候选结果：\n${list}\n\n输出格式：[{"index": 数字, "reason": "一句话理由"}]，index 用上面列表里的编号，按相关性从高到低排列。`,
      },
    });

    if (!Array.isArray(result.output) || result.output.length === 0) {
      fallback.forEach((entry) => out.set(entry.id, entry));
      return out;
    }

    const seen = new Set<string>();
    result.output.forEach((entry, order) => {
      const item = items[entry.index];
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      out.set(item.id, { rank: order + 1, reason: entry.reason });
    });

    // 模型漏掉的条目排在已排序之后，保持稳定
    let nextRank = seen.size + 1;
    items.forEach((item) => {
      if (!seen.has(item.id)) {
        out.set(item.id, { rank: nextRank, reason: undefined });
        nextRank += 1;
      }
    });
    return out;
  }
}

/* ---------- 按月归纳（笔记管理） ---------- */

const MONTH_DIGEST_MAX_NOTES = 20;
const MONTH_DIGEST_SNIPPET = 120;

export class MonthlyDigestAdapter implements MonthlyDigestPort {
  constructor(private readonly router: ModelRouter) {}

  async summarizeMonth(
    notes: { title: string; content: string }[],
    yearMonth: string
  ): Promise<string | undefined> {
    if (notes.length === 0) return undefined;

    // 提示词压缩：只发标题 + 每篇开头片段，最多 20 篇，避免一个月塞爆上下文
    const list = notes
      .slice(0, MONTH_DIGEST_MAX_NOTES)
      .map((note, index) => {
        const title = note.title || '（无标题）';
        const snippet = truncate(note.content.replace(/\s+/g, ' '), MONTH_DIGEST_SNIPPET);
        return index + 1 + '. ' + title + '\n   ' + snippet;
      })
      .join('\n');

    const result = await this.router.run<{ notes: string }, string>({
      taskType: 'light_summary',
      input: { notes: list },
      inlinePrompt: {
        system:
          '你是本地知识库的月度整理助手。用 3-5 句话总结这个月新增笔记的主题与关键要点，语气平实、不带标题。只输出小结正文。',
        user:
          '这是 ' +
          yearMonth +
          ' 月的笔记列表（标题 + 开头片段）：\n\n' +
          list +
          '\n\n请输出当月小结（3-5 句）。',
      },
    });

    if (result.output && result.output.trim()) return result.output.trim();
    return undefined;
  }
}

/* ---------- 知识关联建议 ---------- */

export class KnowledgeLinkSuggestionAdapter implements KnowledgeLinkSuggestionPort {
  constructor(private readonly rag: RAGOrchestrator) {}

  async suggestForNote(
    content: string,
    excludeNoteIds: UUID[],
    limit = 3
  ): Promise<LinkSuggestionCandidate[]> {
    const { suggestions, relationJudged } = await this.rag.findConnections({
      text: content,
      excludeNoteIds,
    });
    // 模型不可用（relationJudged=false）时不出建议，UI 不做无声降级
    if (!relationJudged) return [];

    // 关系判断的端点是 chunk，落到知识图上用「笔记」更直观。
    // 同一篇旧笔记只保留置信度最高的一条，避免给用户刷屏。
    const byNote = new Map<string, LinkSuggestionCandidate>();
    for (const suggestion of suggestions) {
      const existing = byNote.get(suggestion.toNoteId);
      if (!existing || suggestion.confidence > existing.confidence) {
        byNote.set(suggestion.toNoteId, {
          toType: 'note',
          toId: suggestion.toNoteId,
          relationType: suggestion.relationType,
          reason: suggestion.reason,
          confidence: suggestion.confidence,
          excerpt: suggestion.excerpt,
        });
      }
    }
    return [...byNote.values()].slice(0, limit);
  }
}

/* ---------- 深度问答（Self-RAG） ---------- */

/** 薄映射：SelfRag 产出 → application 端口类型。citations 复用检索的 SearchHit 形状 */
export class DeepQAAdapter implements AskNotesPort {
  constructor(private readonly selfRag: SelfRag) {}

  async ask(input: AskNotesQuestion): Promise<AskNotesAnswer> {
    const result = await this.selfRag.ask(input.question, {
      deep: input.deep,
      excludeNoteIds: input.excludeNoteIds,
      onToken: input.onToken,
    });
    return {
      answer: result.answer,
      citations: result.citations.map((c) => ({
        chunkId: c.chunkId,
        noteId: c.noteId,
        text: c.text,
        score: c.score,
        headingPath: c.headingPath,
      })),
      confidence: result.confidence,
      judged: result.judged,
      regenerated: result.regenerated,
      empty: result.empty,
      ok: result.ok,
      critique: result.critique,
    };
  }
}

/* ---------- Flora 写信 ---------- */

export class FloraAdapter implements FloraPort {
  constructor(private readonly agent: FloraAgent) {}

  async sendLetter(input: { letter: string; language: FloraLanguage }): Promise<FloraReply> {
    const result = await this.agent.sendLetter(input.letter, input.language);
    return {
      reply: result.reply,
      emotion: result.emotion,
      verified: result.verified,
      regenerated: result.regenerated,
      ok: result.ok,
    };
  }
}

