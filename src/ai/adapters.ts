import type { NoteSearchOptions } from '@application/ports';
import type { GenerationOptions } from '@application/ports';
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
  FloraPort,
  FloraReply,
  FocusSession,
  KnowledgeLinkSuggestionPort,
  LinkSuggestionCandidate,
  MonthlyDigestPort,
  NoteSearchPort,
  ReviewDraft,
  ReviewFollowUp,
  ReviewObservation,
  ReviewGeneratorPort,
  SearchHit,
  SearchResultEnhancement,
  SearchResultEnhancerPort,
  Todo,
  TodoDraft,
  TodoStructuringPort,
  TodoStructuringOptions,
} from '@application/ports';
import type { UUID } from '@shared-types/common';
import { InteractionGenerator, type CompanionScene } from './companion/interaction-generator';
import type { FloraAgent } from './flora/flora-agent';
import type { RAGOrchestrator } from './rag/rag-orchestrator';
import type { SelfRag } from './rag/self-rag';
import { LinkHydeGenerator } from './rag/link-hyde';
import { buildReviewEvidence } from './rag/review-evidence';
import { buildReviewSources } from './rag/review-sources';
import { verifyReview } from './rag/verify-review';
import type { ModelRouter } from './router/model-router';
import { truncate } from './shared/utils';

export { SocraticQuestionAdapter, ModelUnavailableError } from './socratic';

/* ---------- Todo 拆解 ---------- */

export class TodoStructuringAdapter implements TodoStructuringPort {
  constructor(
    private readonly router: ModelRouter,
    /** 可选：带上相关旧笔记，帮模型复用已有标签、找准起点 */
    private readonly rag?: RAGOrchestrator
  ) {}

  async structure(input: string, options?: TodoStructuringOptions): Promise<TodoDraft[]> {
    const budget = options?.availableMinutes;
    if (budget !== undefined && (!Number.isInteger(budget) || budget < 5 || budget > 1440 || budget % 5 !== 0)) {
      throw new Error('可用时间请填写 5～1440 分钟，且为 5 的倍数。');
    }
    const relatedNotes = await this.collectRelatedNotes(input, options?.signal);

    const result = await this.router.run<{ goal: string }, TodoDraft[]>({
      taskType: 'todo_structuring',
      schemaOverride: budget === undefined ? undefined : 'todo-budgeted.v1',
      signal: options?.signal,
      input: { goal: input },
      promptVars: {
        goal: input,
        relatedNotes: relatedNotes || '（无）',
        timeConstraint: budget === undefined
          ? '未提供本次时间上限，不得假定用户有 120 分钟。尊重目标中明确写出的时间；无法估计则省略 estimatedMinutes。'
          : `本次最多 ${budget} 分钟，每项必须给出 estimatedMinutes，合计不得超过 ${budget}。不缩短用户明确指定的时长；无法同时满足时返回空数组。`,
      },
    });

    // 失败返回空数组，CreateTodoUseCase 会直接结束，用户可手动新建
    const drafts = result.ok ? result.output ?? [] : [];
    const titles = drafts.map(draft => draft.title.trim());
    if (titles.some(title => !title) || new Set(titles).size !== titles.length) {
      throw new Error('拆解结果包含空白或重复任务，请重试或保留原任务。');
    }
    if (budget !== undefined && (drafts.some(draft => draft.estimatedMinutes === undefined)
      || drafts.reduce((total, draft) => total + (draft.estimatedMinutes ?? 0), 0) > budget)) {
      throw new Error('拆解结果未满足本次可用时间，请调整目标或保留原任务。');
    }
    return drafts.map(draft => ({ ...draft, title: draft.title.trim() }));
  }

  private async collectRelatedNotes(goal: string, signal?: AbortSignal): Promise<string> {
    if (!this.rag) return '';
    try {
      const candidates = await this.rag.retrieve({ text: goal, signal }, 3);
      return candidates.map((c) => `- ${truncate(c.text, 150)}`).join('\n');
    } catch (error) {
      signal?.throwIfAborted();
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
    followUps?: ReviewFollowUp[];
  }, options?: GenerationOptions): Promise<ReviewDraft> {
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
    const sources = buildReviewSources(evidence, input.todos, input.followUps, input.knowledgeSummary);
    if (!input.todos.length && !input.focusSessions.length && !input.followUps?.length && !sources.some(source => source.kind === 'knowledge')) {
      return {
        content: `${evidence.period.startDate} 至 ${evidence.period.endDate}，本地没有任务、专注或已采用建议的学习记录。没有记录不代表没有学习，目前无法据此判断学习进度。`,
        summary: '记录不足，暂不生成学习建议', insights: [], nextTodos: [],
        evidence: { observations: [], suggestions: [], sources, limitations: ['缺少可用于复盘的学习记录。'] },
      };
    }

    const result = await this.router.run<typeof input, {
      content: string; summary: string; observations: ReviewObservation[]; nextSteps: ReviewObservation[]; limitations: string[];
    }>({
      signal: options?.signal,
      modelPolicy: { temperature: 0.2 },
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
        dateRange: `${evidence.period.startDate} 至 ${evidence.period.endDate}（${evidence.period.expectedDays} 天）`,
        // 数字与趋势由程序计算，模型只负责选重点和表达——长度收紧，
        // 避免 14B 在长正文 + JSON 转义下输出重复/截断
        contentLength:
          input.reviewType === 'monthly'
            ? '最多 600 字'
            : input.reviewType === 'weekly'
              ? '最多 400 字'
              : '最多 200 字',
        sources: JSON.stringify(sources),
      },
    });

    if (result.ok && result.output) {
      const draft = result.output;
      const sourceIds = new Set(sources.map(source => source.id));
      const entries = [...draft.observations, ...draft.nextSteps];
      if (draft.content.trim() && entries.every(entry => entry.text.trim() && entry.evidenceIds.every(id => sourceIds.has(id)))) {
        // 采集覆盖率本身不能支持学习任务建议，避免空泛地要求用户补应用使用日志。
        const hasPendingAdoption = input.followUps?.some(entry => entry.status === 'pending' || entry.status === 'in_progress');
        const suggestions = hasPendingAdoption ? [] : draft.nextSteps.filter(entry => entry.evidenceIds.some(id => sources.some(source => source.id === id
          && (source.kind === 'task' || source.kind === 'follow_up' || source.kind === 'knowledge'))));
        const verified = await verifyReview(this.router, sources, draft.observations, suggestions, options);
        const limitations = ['本地记录不涵盖全部学习活动；完成任务或计时不代表掌握。'];
        if (!verified.available) limitations.unshift('证据核验未完成；仅展示程序统计，暂不提供 AI 观察或建议。');
        else if (verified.observations.length < draft.observations.length || verified.suggestions.length < suggestions.length)
          limitations.unshift('部分 AI 草稿未通过证据核验，已省略。');
        // Never display the unverified prose, summary or model-invented limitations.
        const facts = `本地记录：${sources[0].description}`;
        return {
          content: [facts, ...verified.observations.map(entry => entry.text)].join('\n\n'),
          summary: verified.observations[0]?.text.slice(0, 120) ?? '本期本地记录摘要',
          insights: verified.observations.map(entry => entry.text), nextTodos: verified.suggestions.map(entry => entry.text),
          evidence: { observations: verified.observations, suggestions: verified.suggestions, sources, limitations },
        };
      }
    }

    // 降级：给出事实骨架，让用户自己写。比抛错强，用户至少不用重新翻数据。
    // 带上失败原因 —— 否则用户只看到「模型未生成」，无从判断是模型没装、
    // 输出格式不对还是超时，也没法据此去设置页排查。
    const reason = result.error ? `${result.error.kind}: ${result.error.message}` : '观察或建议引用了不存在的依据';
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
      evidence: { observations: [], suggestions: [], sources, limitations: ['AI 未生成可核对的观察与建议；此处仅展示程序统计。'] },
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
  health_reminder: 'health_reminder',
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

/* ---------- 本地笔记检索 ---------- */

export class NoteSearchAdapter implements NoteSearchPort {
  constructor(private readonly rag: RAGOrchestrator) {}

  async search(query: string, limit: number, deep?: boolean, options?: NoteSearchOptions): Promise<SearchHit[]> {
    const candidates = await this.rag.retrieve({ text: query, deep, ...options, rerank: deep ?? false }, limit);
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
    results: { id: string; title: string; text: string }[],
    options?: GenerationOptions
  ): Promise<SearchResultEnhancement[]> {
    options?.signal?.throwIfAborted();
    if (results.length === 0) return [];

    // 1) 快速模型逐条摘要；单条失败只影响该条（降级为截断原文）。
    //    分批并发（每批 4 条）而不是一次性全发：本地 Ollama 扛不住几十路并发，
    //    大结果集会互相排队把显存/队列打爆
    const summarized: { id: string; title: string; text: string; summary: string }[] = [];
    const BATCH = 4;
    for (let start = 0; start < results.length; start += BATCH) {
      options?.signal?.throwIfAborted();
      const batch = results.slice(start, start + BATCH);
      const done = await Promise.all(
        batch.map(async (item) => ({
          ...item,
          summary: await this.summarize(item.text, options?.signal),
        }))
      );
      summarized.push(...done);
    }

    // 2) 教师模型软推荐排序 + 理由；失败保持原顺序
    options?.signal?.throwIfAborted();
    const ranked = await this.rank(summarized, options?.signal);
    options?.signal?.throwIfAborted();

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

  private async summarize(text: string, signal?: AbortSignal): Promise<string> {
    const result = await this.router.run<{ text: string }, string>({
      taskType: 'light_summary',
      signal,
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
    items: { id: string; title: string; text: string; summary: string }[],
    signal?: AbortSignal
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
      signal,
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
    yearMonth: string,
    options?: GenerationOptions
  ): Promise<string | undefined> {
    options?.signal?.throwIfAborted();
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
      signal: options?.signal,
      onToken: options?.onToken,
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
  constructor(
    private readonly rag: RAGOrchestrator,
    private readonly hyde: LinkHydeGenerator
  ) {}

  async suggestForNote(
    content: string,
    excludeNoteIds: UUID[],
    limit = 3,
    existingTags: string[] = [],
    options?: GenerationOptions
  ): Promise<LinkSuggestionCandidate[]> {
    // HyDE 召回：先让模型假设「相似的旧笔记会有什么标签/主题」，
    // 再用假设标签 + 原文一起检索，字面不重叠但语义相近的笔记也能被召回。
    const hyde = await this.hyde.generate(content, existingTags, options?.signal);
    const { candidates, suggestions, relationJudged } = await this.rag.findConnections({
      text: content,
      signal: options?.signal,
      tags: hyde.tags,
      excludeNoteIds,
    });

    options?.signal?.throwIfAborted();
    // 模型判断成功（无论有没有关系）→ 以模型结论为准：
    // 有关系用模型的关系类型；模型认为无关系就返回空，不硬凑
    if (relationJudged) {
      return this.toNoteCandidates(suggestions, limit);
    }

    // relationJudged=false：模型不可用 / 判断失败（调用异常、超时、解析失败）。
    // 这时不静默返回空——但只对「真正被检索命中的候选」降级为 review_later 建议
    // （score > 0，规则/向量层确认过相关）。score=0 的兜底候选（listFallback 拉来的
    // 「最近笔记」，只是最近的、未必相关）绝不能降级成建议——否则「秋收起义」会建议
    // 关联「agent」，把无关笔记硬凑在一起。
    const hitCandidates = candidates.filter((c) => c.score > 0);
    if (hitCandidates.length > 0) {
      return this.toNoteCandidates(
        hitCandidates.map((c) => ({
          toId: c.chunkId,
          toType: 'chunk' as const,
          relationType: 'review_later' as const,
          reason: '本地模型暂不可用，这是检索到的最相关旧笔记，请人工判断是否关联',
          confidence: Math.min(0.4 + c.score, 0.85),
          toNoteId: c.noteId,
          excerpt: c.text.slice(0, 120),
        })),
        limit
      );
    }

    return [];
  }

  /** 关系判断的端点是 chunk，落到知识图上用「笔记」更直观。同一篇旧笔记只保留置信度最高的一条 */
  private toNoteCandidates(
    suggestions: Array<{
      toId: string;
      toType: string;
      relationType: string;
      reason: string;
      confidence: number;
      toNoteId: string;
      excerpt: string;
    }>,
    limit: number
  ): LinkSuggestionCandidate[] {
    const byNote = new Map<string, LinkSuggestionCandidate>();
    for (const suggestion of suggestions) {
      const existing = byNote.get(suggestion.toNoteId);
      if (!existing || suggestion.confidence > existing.confidence) {
        byNote.set(suggestion.toNoteId, {
          toType: 'note',
          toId: suggestion.toNoteId,
          relationType: suggestion.relationType as LinkSuggestionCandidate['relationType'],
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
      signal: input.signal,
      excludeNoteIds: input.excludeNoteIds,
      onToken: input.onToken,
      onProgress: input.onProgress,
    });
    return {
      answer: result.answer,
      citations: result.citations.map((c) => ({
        chunkId: c.chunkId,
        noteId: c.noteId,
        text: c.text,
        supportingClaim: c.supportingClaim,
        charStart: c.charStart,
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

  async sendLetter(input: Parameters<FloraPort['sendLetter']>[0], options?: GenerationOptions): Promise<FloraReply> {
    const result = await this.agent.sendLetter(input.letter, input.language, options, input.history);
    return {
      reply: result.reply,
      emotion: result.emotion,
      verified: result.verified,
      verificationStatus: result.verificationStatus,
      regenerated: result.regenerated,
      ok: result.ok,
    };
  }
}

