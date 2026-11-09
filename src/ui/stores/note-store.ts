/**
 * 笔记 store
 *
 * 检索结果单独存一份，不和笔记列表混在一起：搜索是临时视图，
 * 笔记列表是持久数据，混在一个字段里会让「清空搜索」变成重新加载全部。
 *
 * 外部搜索结果同样单独存放，不落库。用户点「保存为笔记」后才走 ImportNote 写库。
 */
import { create } from 'zustand';
import type { Note, SearchHit } from '@shared-types/domain';
import type { KnowledgeProgress, AskNotesAnswer, AskSession, ImportSource, SearchResultEnhancement } from '@application/ports';
import type { SearchNotesResult } from '@application/use-cases/note/search-notes';
import type { UpdateNotePatch } from '@application/use-cases/note/update-note';
import type { RankedResult } from '@ai/search/result-filter';
import { useKnowledgeLinkStore } from './knowledge-link-store';
import { useToastStore } from './toast-store';
import { abortable } from '@application/shared/abortable';
import { splitPlainIntoParagraphs } from '@application/shared/utils';
import { ai, aiMode, describeError, repositories, useCases } from './runtime';

interface NoteState {
  notes: Note[];
  hits: SearchHit[];
  query: string;
  /** 外部搜索结果（临时，不落库） */
  externalResults: RankedResult[];
  externalQueries: string[];
  /** 外部搜索是否可用，以及被拦的原因（专注模式或隐私设置） */
  externalSearchAvailable: boolean;
  externalSearchAttempted: boolean;
  externalBlockedReason?: string;
  /** 需要用户确认后才发起外部搜索 */
  confirmationRequired: boolean;
  keywordFallback?: boolean;
  /** Self-RAG 信号：本地最高分命中仍偏低 */
  localLowConfidence: boolean;
  searching: boolean;
  searchProgress: KnowledgeProgress[];
  askProgress: KnowledgeProgress[];
  searchKeywordReady: boolean;
  searchElapsedMs?: number;
  askElapsedMs?: number;
  firstTokenMs?: number;
  /** 导入后正在自动关联已有知识 */
  linking: boolean;
  /** 最近搜索（设置表持久化） */
  history: string[];
  /** 搜索结果的 AI 整理（快速摘要 + 教师软推荐），按结果 id 索引 */
  enhancements: Record<string, SearchResultEnhancement>;
  /** 正在用模型整理搜索结果 */
  enhancing: boolean;
  error?: string;
  refresh: () => Promise<void>;
  retryingIndex: Record<string, boolean>;
  retryIndex: (noteId: string) => Promise<void>;
  refreshIndex: (noteId: string) => Promise<void>;
  /** 对当前搜索结果做 AI 整理：快速模型摘要 + 教师模型软推荐 */
  enhanceResults: () => Promise<void>;
  cancelEnhancement: () => void;
  /**
   * 导入。来源必须显式说明是文件路径还是直接给的文本 ——
   * 之前两者共用一个 string，粘贴的正文在桌面端会被当路径解析而报错。
   */
  importPhase: 'idle' | 'parsing' | 'checking' | 'saving';
  importOutcome?: string;
  cancelImport: () => void;
  importNote: (source: ImportSource) => Promise<'imported' | 'cancelled' | 'failed' | 'busy'>;
  /** 把外部搜索结果存为新笔记 */
  importExternalResult: (result: RankedResult) => Promise<'imported' | 'cancelled' | 'failed' | 'busy'>;
  /** 导入后自动尝试建立知识关联（后台跑，不阻塞导入；普通导入与外部搜索导入共用） */
  suggestLinksForNote: (noteId: string) => Promise<void>;

  update: (noteId: string, patch: UpdateNotePatch) => Promise<void>;
  /** 删除笔记（用户主动删除，直接写库；顺带清理向量） */
  delete: (noteId: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  /** 用户确认后，重新发起带外部搜索的查询。query 为空时用 store 里最近一次搜索词 */
  confirmExternalSearch: (query?: string) => Promise<void>;
  clearSearch: () => void;
  /** 深度检索开关（LLM Multi-Query + HyDE，慢但更准） */
  deep: boolean;
  setDeep: (deep: boolean) => void;
  /** 按月归纳：yearMonth(YYYY-MM) → 小结文本与生成状态 */
  cancelDigest: (yearMonth: string) => void;
  digests: Record<string, { text: string; loading: boolean }>;
  summarizeMonth: (yearMonth: string, notes: { title: string; content: string }[]) => Promise<void>;
  /** 深度问答（Self-RAG）结果：检索 + 生成 + 自我评判，只读不落库 */
  deepAnswer: AskNotesAnswer | null;
  /** 深度问答生成中 */
  asking: boolean;
  /** 深度问答生成中的流式预览（最终以 deepAnswer.answer 为准） */
  streamingAnswer: string;
  cancelQuestion: () => void;
  askQuestion: (question: string) => Promise<void>;
  /** 深度问答历史（持久化，可回看 / 删除） */
  askHistory: AskSession[];
  askHistoryLoading: boolean;
  refreshAskHistory: () => Promise<void>;
  deleteAskHistory: (id: string) => Promise<void>;
}

/** 本地关键词兜底：RAG/向量无命中时，在已导入笔记里按段落做关键词匹配。
 * 返回段落级命中（不是整条笔记），每段带 charStart 供 UI 定位；
 * 同一篇笔记最多 3 段，避免大文件独占结果。 */
function localKeywordFallback(query: string, notes: Note[]): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];

  const MAX_PER_NOTE = 3;
  const hits: SearchHit[] = [];
  for (const note of notes) {
    const paragraphs = splitPlainIntoParagraphs(note.content);
    // 标签也参与匹配：搜索词恰好是某笔记标签时，即使正文没这个词也该命中（web 演示与桌面端一致）
    const tagLine = note.tags.join(' ');
    const noteHits = paragraphs
      .map((paragraph, index) => {
        const haystack = `${note.title}\n${tagLine}\n${paragraph.text}`.toLowerCase();
        const matches = terms.filter((term) => haystack.includes(term)).length;
        return { paragraph, index, matches };
      })
      .filter((entry) => entry.matches > 0)
      .sort((left, right) => right.matches - left.matches)
      .slice(0, MAX_PER_NOTE);
    for (const entry of noteHits) {
      hits.push({
        chunkId: `${note.id}#${entry.index}`,
        noteId: note.id,
        text: entry.paragraph.text,
        score: entry.matches / terms.length,
        charStart: entry.paragraph.charStart,
      });
    }
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, 10);
}

export const useNoteStore = create<NoteState>((set, get) => {
  const HISTORY_KEY = 'search.history';
  const HISTORY_MAX = 5;

  // 搜索请求序号：连续搜索 A→B 时，A 晚返回不能覆盖 B 的结果
  let importSequence = 0;
  let importController: AbortController | undefined;
  let searchSeq = 0;
  let searchController: AbortController | undefined;
  // 深度问答请求序号：只允许最新一次问答写回结果
  let enhancementController: AbortController | undefined;
  const digestControllers = new Map<string, AbortController>();
  let askSeq = 0;
  let askController: AbortController | undefined;
  const indexReads = new Map<string, number>();
  let indexReadSequence = 0;

  const loadHistory = async (): Promise<string[]> => {
    const raw = await repositories.settings.get(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  };

  const saveHistory = (history: string[]): Promise<void> =>
    repositories.settings.set(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));

  return {
  notes: [],
  searchProgress: [], askProgress: [], searchKeywordReady: false,
  retryingIndex: {},
  refreshIndex: async (noteId) => {
    const sequence = ++indexReadSequence;
    indexReads.set(noteId, sequence);
    try {
      const fresh = await repositories.note.findById(noteId);
      if (indexReads.get(noteId) !== sequence || !fresh) return;
      set(state => ({ notes: state.notes.map(note => note.id === noteId
        ? { ...note, indexStatus: fresh.indexStatus, indexError: fresh.indexError } : note) }));
    } catch (error) {
      if (indexReads.get(noteId) === sequence) set({ error: describeError(error) });
    } finally {
      if (indexReads.get(noteId) === sequence) indexReads.delete(noteId);
    }
  },
  retryIndex: async (noteId) => {
    if (get().retryingIndex[noteId]) return;
    indexReads.delete(noteId);
    set(state => ({ retryingIndex: { ...state.retryingIndex, [noteId]: true }, error: undefined }));
    try {
      const result = await useCases.retryNoteIndex.execute(noteId);
      const message = result === 'queued' ? '已加入索引队列；专注期间暂停，退出专注后继续。'
        : result === 'busy' ? '这篇笔记已有索引任务，无需重复提交。' : '网页演示不提供向量索引，请使用桌面或 Anna 本地版。';
      useToastStore.getState().show(message, 'info');
      await get().refreshIndex(noteId);
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set(state => {
        const retryingIndex = { ...state.retryingIndex };
        delete retryingIndex[noteId];
        return { retryingIndex };
      });
    }
  },
  hits: [],
  query: '',
  externalResults: [],
  externalQueries: [],
  externalSearchAvailable: false,
  externalSearchAttempted: false,
  confirmationRequired: false,
  localLowConfidence: false,
  searching: false,
  linking: false,
  deepAnswer: null,
  asking: false,
  streamingAnswer: '',
  askHistory: [],
  askHistoryLoading: false,
  history: [],
  enhancements: {},
  enhancing: false,
  deep: false,
  setDeep: (deep) => set({ deep }),
  digests: {},
  cancelDigest: (yearMonth) => {
    digestControllers.get(yearMonth)?.abort();
    digestControllers.delete(yearMonth);
    set(state => ({ digests: { ...state.digests, [yearMonth]: { text: '已停止生成', loading: false } } }));
  },
  summarizeMonth: async (yearMonth, notes) => {
    if (digestControllers.has(yearMonth)) return;
    const controller = new AbortController();
    digestControllers.set(yearMonth, controller);
    set(state => ({ digests: { ...state.digests, [yearMonth]: { text: '', loading: true } } }));
    try {
      const text = await abortable(ai.ports.noteDigest.summarizeMonth(notes, yearMonth, {
        signal: controller.signal,
        onToken: (delta, reset) => {
          if (digestControllers.get(yearMonth) !== controller) return;
          set(state => ({ digests: { ...state.digests, [yearMonth]: {
            text: reset ? '' : (state.digests[yearMonth]?.text ?? '') + delta, loading: true,
          } } }));
        },
      }), controller.signal);
      if (digestControllers.get(yearMonth) !== controller) return;
      set(state => ({ digests: { ...state.digests, [yearMonth]: {
        text: text ?? '未能生成小结，请检查本地模型是否可用', loading: false,
      } } }));
    } catch (error) {
      if (digestControllers.get(yearMonth) !== controller) return;
      set(state => ({ digests: { ...state.digests, [yearMonth]: {
        text: `生成失败：${describeError(error)}`, loading: false,
      } } }));
    } finally {
      if (digestControllers.get(yearMonth) === controller) digestControllers.delete(yearMonth);
    }
  },

  cancelEnhancement: () => {
    enhancementController?.abort();
    enhancementController = undefined;
    set({ enhancing: false });
  },

  enhanceResults: async () => {
    const { hits, externalResults, query } = get();
    const items = [
      ...hits.map((hit) => ({ id: `hit:${hit.chunkId}`, title: hit.noteId, text: hit.text })),
      ...externalResults.map((result) => ({
        id: `ext:${result.url}`,
        title: result.title,
        text: result.snippet ?? result.title,
      })),
    ];
    if (items.length === 0 || !query) return;
    get().cancelEnhancement();
    const controller = new AbortController();
    enhancementController = controller;
    set({ enhancing: true });
    try {
      const enhanced = await useCases.enhanceSearchResults.execute({ results: items, signal: controller.signal });
      if (enhancementController !== controller) return;
      const byId: Record<string, SearchResultEnhancement> = {};
      for (const entry of enhanced) byId[entry.id] = entry;
      set({ enhancements: byId, enhancing: false });
    } catch (error) {
      if (enhancementController !== controller) return;
      set({ enhancing: false, error: describeError(error) });
    } finally {
      if (enhancementController === controller) enhancementController = undefined;
    }
  },

  refresh: async () => {
    try {
      const [notes, history] = await Promise.all([
        repositories.note.listAll(),
        loadHistory(),
      ]);
      set({ notes, history });
      void get().refreshAskHistory();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  refreshAskHistory: async () => {
    set({ askHistoryLoading: true });
    try {
      const list = await useCases.listAskSessions.execute(50);
      set({ askHistory: list, askHistoryLoading: false });
    } catch (error) {
      set({ askHistoryLoading: false, error: describeError(error) });
    }
  },

  deleteAskHistory: async (id) => {
    try {
      await useCases.deleteAskSession.execute(id);
      await get().refreshAskHistory();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  importPhase: 'idle',
  cancelImport: () => {
    if (!['parsing', 'checking'].includes(get().importPhase)) return;
    importSequence += 1;
    importController?.abort();
    set({ importPhase: 'idle', importOutcome: '已停止导入，未新增笔记。', error: undefined });
  },

  importNote: async (source) => {
    if (get().importPhase !== 'idle') return 'busy';
    const seq = ++importSequence;
    const controller = new AbortController();
    importController = controller;
    set({ error: undefined, importOutcome: undefined, importPhase: 'parsing' });
    let duplicate = false;
    try {
      const note = await useCases.importNote.execute(source, {
        signal: controller.signal,
        onDuplicate: () => { duplicate = true; },
        onPhase: (phase) => { if (seq === importSequence) set({ importPhase: phase }); },
      });
      if (seq !== importSequence) return 'cancelled';
      await get().refresh();
      if (seq !== importSequence) return 'cancelled';
      set({ importOutcome: duplicate ? '已有相同内容，已保留原笔记。' : '笔记已导入，索引将在后台处理。' });
      // Association only starts after a successful save; cancellation cannot open a late proposal.
      if (note && !duplicate) void get().suggestLinksForNote(note.id);
      return 'imported';
    } catch (error) {
      if (seq !== importSequence) return 'cancelled';
      set({ error: describeError(error) });
      return 'failed';
    } finally {
      if (seq === importSequence) {
        importController = undefined;
        set({ importPhase: 'idle' });
      }
    }
  },

  importExternalResult: async (result) => {
    set({ error: undefined });
    try {
      const content = [
        `# ${result.title}`,
        '',
        result.snippet ?? '',
        '',
        `> 来源：[${result.site ?? result.url}](${result.url})`,
        result.reason ? `> 推荐理由：${result.reason}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return await get().importNote({
        kind: 'text',
        content,
        title: result.title.slice(0, 120),
      });

    } catch (error) {
      set({ error: describeError(error) });
      return 'failed';
    }
  },

  /** 导入后自动尝试与已有知识建立关联（后台跑，不阻塞导入） */
  suggestLinksForNote: async (noteId) => {
    set({ linking: true });
    try {
      const result = await useKnowledgeLinkStore.getState().suggestForNote(noteId);
      if (result.cancelled || result.skipped) return;
      if (result.created.length > 0) {
        useToastStore.getState().show(
          `已建立 ${result.created.length} 条知识关联`,
          'ok'
        );
      } else if (result.suggested === 0) {
        // 演示模式（无本地模型）下 AI 无法判断关系：明确告诉用户「没能力」而不是「没关联」。
        // 桌面端模型不可用时，adapter 已把检索到的候选降级为「人工确认」建议（suggested>0），
        // 不会走到这里——走到这里说明模型正常但确实没有相关旧笔记。
        if (aiMode === 'template') {
          useToastStore.getState().show('演示模式无本地模型，无法自动关联笔记', 'info');
        } else {
          useToastStore.getState().show('未找到与现有笔记的关联', 'info');
        }
      }
      // suggested > 0 但 created 为空：用户拒绝了建议，不打扰
    } catch {
      // 关联建议失败不影响导入本身；linking 标记也要复位
    } finally {
      set({ linking: false });
    }
  },

  update: async (noteId, patch) => {
    set({ error: undefined });
    try {
      await useCases.updateNote.execute(noteId, patch);
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  delete: async (noteId) => {
    set({ error: undefined });
    try {
      // 走确认弹窗，用户点头才删
      const confirmed = await useCases.deleteNote.execute(noteId);
      if (confirmed) {
        await get().refresh();
        // 删除会级联清掉该笔记的知识链接：图谱/徽章数据同步刷新，不残留悬空节点
        await useKnowledgeLinkStore.getState().refresh().catch(() => undefined);
      }
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  search: async (query) => {
    get().cancelQuestion();
    get().cancelEnhancement();
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    const started = performance.now();
    set({ enhancements: {} });
    const trimmed = query.trim();
    const seq = ++searchSeq; // 本次搜索的序号，只允许最新一次写回结果
    set({ query, hits: [], searching: true, searchKeywordReady: false, searchProgress: [], searchElapsedMs: undefined, error: undefined, deepAnswer: null, streamingAnswer: '', externalResults: [], externalQueries: [] });
    if (trimmed) {
      const next = [trimmed, ...get().history.filter((item) => item !== trimmed)].slice(0, 5);
      set({ history: next });
      void saveHistory(next).catch(() => undefined);
    }
    try {
      const result: SearchNotesResult = await useCases.searchNotes.execute(query, 10, 'user_explicit', get().deep, {
        signal: controller.signal,
        onPartial: hits => {
          if (seq === searchSeq && !controller.signal.aborted) set({ hits, searchKeywordReady: true });
        },
        onProgress: progress => {
          if (seq === searchSeq && !controller.signal.aborted) set(state => ({ searchProgress: [...state.searchProgress, progress] }));
        },
      });
      if (seq !== searchSeq) return; // 已有更新的搜索，丢弃本次结果
      // RAG/向量无命中时，用关键词在已导入笔记里兜底，保证已索引内容可被找到
      const hits =
        result.hits.length > 0 ? result.hits : localKeywordFallback(query, get().notes);
      set({
        hits,
        localLowConfidence: result.localLowConfidence,
        externalResults: result.externalResults,
        externalQueries: result.externalQueries,
        externalSearchAvailable: result.externalSearchAvailable,
        externalSearchAttempted: result.externalSearchAttempted,
        externalBlockedReason: result.externalBlockedReason,
        confirmationRequired: result.confirmationRequired,
        keywordFallback: result.keywordFallback,
        searching: false,
        searchElapsedMs: performance.now() - started,
      });
      // Result summaries are explicit, so they do not compete with the next question.
    } catch (error) {
      if (seq !== searchSeq) return;
      set({ searching: false, error: describeError(error) });
    }
  },

  confirmExternalSearch: async (queryArg) => {
    // 输入框的关键词未必同步进了 store.query（用户可能直接点「搜索网络」）。
    // 优先用传入的关键词；没有再退回 store 里最近一次搜索词。
    const query = (queryArg ?? get().query ?? '').trim();
    if (!query) return;

    get().cancelEnhancement();
    searchController?.abort();
    const seq = ++searchSeq;
    set({ searchProgress: [], searchElapsedMs: undefined, query, searching: true, error: undefined, confirmationRequired: false, enhancements: {} });
    try {
      const result = await useCases.searchNotes.executeWithConfirmation(query);
      if (seq !== searchSeq) return;
      const hits =
        result.hits.length > 0 ? result.hits : localKeywordFallback(query, get().notes);
      set({
        hits,
        externalResults: result.externalResults,
        externalQueries: result.externalQueries,
        externalSearchAvailable: result.externalSearchAvailable,
        externalSearchAttempted: result.externalSearchAttempted,
        externalBlockedReason: result.externalBlockedReason,
        keywordFallback: result.keywordFallback,
        searching: false,
      });
      // Result summaries are explicit, so they do not compete with the next question.
    } catch (error) {
      if (seq !== searchSeq) return;
      set({ searching: false, error: describeError(error) });
    }
  },

  clearSearch: () => {
    searchController?.abort();
    get().cancelEnhancement();
    askController?.abort();
    searchSeq += 1; // 清空后让在途搜索的结果作废
    askSeq += 1; // 在途深度问答同样作废：否则清空后旧答案仍会写回并弹回界面
    set({
      query: '',
      hits: [],
      searchProgress: [], askProgress: [], searchElapsedMs: undefined, askElapsedMs: undefined, firstTokenMs: undefined, searchKeywordReady: false,
      externalResults: [],
      externalQueries: [],
      externalBlockedReason: undefined,
      confirmationRequired: false,
      externalSearchAttempted: false,
      enhancements: {},
      enhancing: false,
      deepAnswer: null,
      streamingAnswer: '',
      asking: false,
      searching: false, // 在途搜索被 seq 丢弃后不再有机会置 false，这里直接复位
    });
  },

  cancelQuestion: () => {
    askSeq += 1;
    askController?.abort();
    set({ asking: false, streamingAnswer: '' });
  },

  askQuestion: async (question) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    get().cancelEnhancement();
    searchController?.abort();
    searchSeq += 1;
    askController?.abort();
    const started = performance.now();
    const controller = new AbortController();
    askController = controller;
    const seq = ++askSeq; // 只允许最新一次问答写回结果
    set({ asking: true, searching: false, askProgress: [], askElapsedMs: undefined, firstTokenMs: undefined, deepAnswer: null, error: undefined, streamingAnswer: '' });
    try {
      const result = await useCases.askNotes.execute(trimmed, {
        signal: controller.signal,
        deep: get().deep,
        onProgress: progress => {
          if (seq === askSeq && !controller.signal.aborted) set(state => ({ askProgress: [...state.askProgress, progress] }));
        },
        onToken: (delta, reset) => {
          if (seq !== askSeq) return; // 已有更新的问答，丢弃增量
          if (delta && !reset && get().firstTokenMs === undefined) set({ firstTokenMs: performance.now() - started });
          // 精修稿整体替换草稿：reset 先清空旧预览，避免 draft1+精修稿 拼在一起
          set(reset ? { streamingAnswer: '' } : (state) => ({ streamingAnswer: state.streamingAnswer + delta }));
        },
      });
      if (seq !== askSeq) return;
      set({ deepAnswer: result, asking: false, streamingAnswer: '', askElapsedMs: performance.now() - started });
      // 落库进问答历史（无相关笔记的问答不值得存）
      if (!result.empty) {
        try {
          await useCases.saveAskSession.execute({
            question: trimmed,
            answer: result.answer,
            citations: result.citations,
            confidence: result.confidence,
            judged: result.judged,
            regenerated: result.regenerated,
            ok: result.ok,
            empty: result.empty,
            critique: result.critique,
          });
          void get().refreshAskHistory();
        } catch (error) {
          console.warn('[note-store] 问答历史保存失败:', error);
        }
      }
    } catch (error) {
      if (seq !== askSeq) return;
      set({ asking: false, streamingAnswer: '', error: describeError(error) });
    }
  },
};
});
