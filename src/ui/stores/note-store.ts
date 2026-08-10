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
import type { AskNotesAnswer, AskSession, ImportSource, SearchResultEnhancement } from '@application/ports';
import type { SearchNotesResult } from '@application/use-cases/note/search-notes';
import type { UpdateNotePatch } from '@application/use-cases/note/update-note';
import type { RankedResult } from '@ai/search/result-filter';
import { useKnowledgeLinkStore } from './knowledge-link-store';
import { ai, describeError, repositories, useCases } from './runtime';

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
  /** 对当前搜索结果做 AI 整理：快速模型摘要 + 教师模型软推荐 */
  enhanceResults: () => Promise<void>;
  /**
   * 导入。来源必须显式说明是文件路径还是直接给的文本 ——
   * 之前两者共用一个 string，粘贴的正文在桌面端会被当路径解析而报错。
   */
  importNote: (source: ImportSource) => Promise<void>;
  /** 把外部搜索结果存为新笔记 */
  importExternalResult: (result: RankedResult) => Promise<void>;

  update: (noteId: string, patch: UpdateNotePatch) => Promise<void>;
  /** 删除笔记（用户主动删除，直接写库；顺带清理向量） */
  delete: (noteId: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  /** 用户确认后，重新发起带外部搜索的查询 */
  confirmExternalSearch: () => Promise<void>;
  clearSearch: () => void;
  /** 深度检索开关（LLM Multi-Query + HyDE，慢但更准） */
  deep: boolean;
  setDeep: (deep: boolean) => void;
  /** 按月归纳：yearMonth(YYYY-MM) → 小结文本与生成状态 */
  digests: Record<string, { text: string; loading: boolean }>;
  summarizeMonth: (yearMonth: string, notes: { title: string; content: string }[]) => Promise<void>;
  /** 深度问答（Self-RAG）结果：检索 + 生成 + 自我评判，只读不落库 */
  deepAnswer: AskNotesAnswer | null;
  /** 深度问答生成中 */
  asking: boolean;
  /** 深度问答生成中的流式预览（最终以 deepAnswer.answer 为准） */
  streamingAnswer: string;
  askQuestion: (question: string) => Promise<void>;
  /** 深度问答历史（持久化，可回看 / 删除） */
  askHistory: AskSession[];
  askHistoryLoading: boolean;
  refreshAskHistory: () => Promise<void>;
  deleteAskHistory: (id: string) => Promise<void>;
}

/** 本地关键词兜底：RAG/向量无命中时，在已导入笔记标题/内容里做关键词匹配 */
function localKeywordFallback(query: string, notes: Note[]): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
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
    .slice(0, 10);
}

export const useNoteStore = create<NoteState>((set, get) => {
  const HISTORY_KEY = 'search.history';
  const HISTORY_MAX = 5;

  // 搜索请求序号：连续搜索 A→B 时，A 晚返回不能覆盖 B 的结果
  let searchSeq = 0;
  // 深度问答请求序号：只允许最新一次问答写回结果
  let askSeq = 0;

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
  summarizeMonth: async (yearMonth, notes) => {
    set((state) => ({
      digests: { ...state.digests, [yearMonth]: { text: '', loading: true } },
    }));
    try {
      const text = await ai.ports.noteDigest.summarizeMonth(notes, yearMonth);
      set((state) => ({
        digests: {
          ...state.digests,
          [yearMonth]: { text: text ?? '未能生成小结，请检查本地模型是否可用', loading: false },
        },
      }));
    } catch (error) {
      set((state) => ({
        digests: {
          ...state.digests,
          [yearMonth]: { text: `生成失败：${describeError(error)}`, loading: false },
        },
      }));
    }
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
    set({ enhancing: true });
    try {
      const enhanced = await useCases.enhanceSearchResults.execute({ results: items });
      const byId: Record<string, SearchResultEnhancement> = {};
      for (const entry of enhanced) byId[entry.id] = entry;
      set({ enhancements: byId, enhancing: false });
    } catch (error) {
      set({ enhancing: false, error: describeError(error) });
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

  importNote: async (source) => {
    set({ error: undefined });
    try {
      const note = await useCases.importNote.execute(source);
      await get().refresh();

      // 导入后自动尝试与已有知识建立关联：有建议会弹全局确认框，用户决定是否写入
      if (note) {
        set({ linking: true });
        try {
          await useKnowledgeLinkStore.getState().suggestForNote(note.id);
        } finally {
          set({ linking: false });
        }
      }
    } catch (error) {
      set({ error: describeError(error) });
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

      await useCases.importNote.execute({
        kind: 'text',
        content,
        title: result.title.slice(0, 120),
      });
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
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
      if (confirmed) await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  search: async (query) => {
    const trimmed = query.trim();
    const seq = ++searchSeq; // 本次搜索的序号，只允许最新一次写回结果
    set({ query, searching: true, error: undefined, deepAnswer: null, streamingAnswer: '', externalResults: [], externalQueries: [] });
    if (trimmed) {
      const next = [trimmed, ...get().history.filter((item) => item !== trimmed)].slice(0, 5);
      set({ history: next });
      void saveHistory(next).catch(() => undefined);
    }
    try {
      const result: SearchNotesResult = await useCases.searchNotes.execute(query, 10, 'user_explicit', get().deep);
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
      });
      void get().enhanceResults();
    } catch (error) {
      if (seq !== searchSeq) return;
      set({ searching: false, error: describeError(error) });
    }
  },

  confirmExternalSearch: async () => {
    const query = get().query;
    if (!query) return;

    set({ searching: true, error: undefined, confirmationRequired: false });
    try {
      const result = await useCases.searchNotes.executeWithConfirmation(query);
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
      void get().enhanceResults();
    } catch (error) {
      set({ searching: false, error: describeError(error) });
    }
  },

  clearSearch: () => {
    searchSeq += 1; // 清空后让在途搜索的结果作废
    set({
      query: '',
      hits: [],
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
    });
  },

  askQuestion: async (question) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const seq = ++askSeq; // 只允许最新一次问答写回结果
    set({ asking: true, error: undefined, streamingAnswer: '' });
    try {
      const result = await useCases.askNotes.execute(trimmed, {
        deep: true,
        onToken: (delta, reset) => {
          if (seq !== askSeq) return; // 已有更新的问答，丢弃增量
          // 精修稿整体替换草稿：reset 先清空旧预览，避免 draft1+精修稿 拼在一起
          set(reset ? { streamingAnswer: '' } : (state) => ({ streamingAnswer: state.streamingAnswer + delta }));
        },
      });
      if (seq !== askSeq) return;
      set({ deepAnswer: result, asking: false, streamingAnswer: '' });
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
