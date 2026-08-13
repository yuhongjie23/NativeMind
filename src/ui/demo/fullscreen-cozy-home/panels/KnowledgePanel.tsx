/**
 * 「知识」面板 —— 真实笔记检索与导入。
 *
 * 检索走 useNoteStore.search（本地向量 + 可选外部搜索）；最近搜索来自持久化
 * history；快速导入粘贴文本写为真实笔记。外部搜索被拦时明确说出原因。
 */
import { ArrowRight, BookMarked, Link2, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Note } from '@shared-types/domain';
import { useT } from '../../../i18n';
import { Modal } from '../../../components/common/Modal';
import { NoteViewer } from '../../../components/features/NoteViewer';
import { useNoteStore } from '../../../stores/note-store';
import { useKnowledgeLinkStore, RELATION_LABELS } from '../../../stores/knowledge-link-store';
import { useToastStore } from '../../../stores/toast-store';
import { useSettingsStore } from '../../../stores/settings-store';
import { listReadableDocs, openExternal, type ReadableDoc } from '@infrastructure/paths/paths-api';
import { describeError } from '../../../stores/runtime';
import { usePanelDirty } from '../panel-dirty';

export function KnowledgePanel() {
  const t = useT();
  const language = useSettingsStore((state) => state.language);
  const notes = useNoteStore((state) => state.notes);
  const hits = useNoteStore((state) => state.hits);
  const query = useNoteStore((state) => state.query);
  const history = useNoteStore((state) => state.history);
  const searching = useNoteStore((state) => state.searching);
  const enhancing = useNoteStore((state) => state.enhancing);
  const enhancements = useNoteStore((state) => state.enhancements);
  const error = useNoteStore((state) => state.error);
  const externalResults = useNoteStore((state) => state.externalResults);
  const confirmationRequired = useNoteStore((state) => state.confirmationRequired);
  const localLowConfidence = useNoteStore((state) => state.localLowConfidence);
  const externalSearchAttempted = useNoteStore((state) => state.externalSearchAttempted);
  const externalSearchAvailable = useNoteStore((state) => state.externalSearchAvailable);
  const blockedReason = useNoteStore((state) => state.externalBlockedReason);
  const refresh = useNoteStore((state) => state.refresh);
  const search = useNoteStore((state) => state.search);
  const clearSearch = useNoteStore((state) => state.clearSearch);
  const deep = useNoteStore((state) => state.deep);
  const setDeep = useNoteStore((state) => state.setDeep);
  const deepAnswer = useNoteStore((state) => state.deepAnswer);
  const asking = useNoteStore((state) => state.asking);
  const streamingAnswer = useNoteStore((state) => state.streamingAnswer);
  const askQuestion = useNoteStore((state) => state.askQuestion);
  const askHistory = useNoteStore((state) => state.askHistory);
  const askHistoryLoading = useNoteStore((state) => state.askHistoryLoading);
  const deleteAskHistory = useNoteStore((state) => state.deleteAskHistory);
  const confirmExternalSearch = useNoteStore((state) => state.confirmExternalSearch);
  const importNote = useNoteStore((state) => state.importNote);
  const importExternalResult = useNoteStore((state) => state.importExternalResult);
  const deleteNote = useNoteStore((state) => state.delete);
  const updateNote = useNoteStore((state) => state.update);
  // 每篇笔记的已确认关联数（链接徽章用）；打开面板时拉一次
  const linkCounts = useKnowledgeLinkStore((state) => state.linkCounts);

  const [viewMode, setViewMode] = useState<'search' | 'notes' | 'import'>('search');
  const [keyword, setKeyword] = useState('');
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  // 手动「查找关联」进行中（按钮禁用 + 进度提示）
  const [linking, setLinking] = useState(false);
  // 导入标签：逗号/空格分隔，提交时解析成数组（标签是检索的重要依据）
  const [importTags, setImportTags] = useState('');
  // 解析导入标签输入：按中文/英文逗号与空白切分，去重去空
  const parseImportTags = (): string[] =>
    [...new Set(importTags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))];
  const [importingFile, setImportingFile] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedHint, setSavedHint] = useState('');
  // 读取目录里的可导入文档（设置里配置的「读取目录（导入文档用）」）
  const [readableDocs, setReadableDocs] = useState<ReadableDoc[]>([]);
  const [importingDoc, setImportingDoc] = useState<string | null>(null);
  const [importDocError, setImportDocError] = useState('');
  const readDirs = useSettingsStore((state) => state.paths.readDirs);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  // 打开笔记时定位到的段落（检索命中段，无则从头部开始）
  const [viewingNoteStart, setViewingNoteStart] = useState<number | undefined>(undefined);
  // 命中段落文本：优先用它在正文里 indexOf 精确定位（比 charStart 抗漂移）
  const [viewingNoteAnchor, setViewingNoteAnchor] = useState<string | undefined>(undefined);
  // 当前打开笔记的已确认关联（相关笔记区块）
  const [related, setRelated] = useState<
    Array<{ noteId: string; title: string; relationType: string }>
  >([]);
  // 笔记详情里编辑标签的草稿（新增标签输入框的值）
  const [tagDraft, setTagDraft] = useState('');
  // 笔记整理双栏：左栏选中的笔记（默认选中第一篇，无则空）
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // 右栏展示的笔记：优先选中项；选中项被删/不存在时回退到列表第一篇
  const selectedNote = useMemo(
    () =>
      notes.find((note) => note.id === selectedNoteId) ??
      notes[0] ??
      null,
    [notes, selectedNoteId],
  );

  const openHit = (noteId: string, charStart?: number, hitText?: string) => {
    setViewingNote(notes.find((note) => note.id === noteId) ?? null);
    setViewingNoteStart(charStart);
    setViewingNoteAnchor(hitText);
    // 打开笔记时拉取已确认的知识关联
    setRelated([]);
    void useKnowledgeLinkStore.getState().relatedNotes(noteId).then(setRelated);
  };

  // 手动触发 AI 关联建议（导入时没建、或当时模型不可用的笔记，补一次机会）
  const relinkNote = async (noteId: string) => {
    setLinking(true);
    try {
      const result = await useKnowledgeLinkStore.getState().suggestForNote(noteId);
      // 刷新已确认关联列表（确认写入后图谱与这里都会更新）
      const fresh = await useKnowledgeLinkStore.getState().relatedNotes(noteId);
      setRelated(fresh);
      if (result.created.length > 0) {
        useToastStore.getState().show(
          `已建立 ${result.created.length} 条知识关联`,
          'ok'
        );
      } else if (result.suggested > 0) {
        // 用户拒绝了建议，不打扰（确认框已给过反馈）
      } else {
        useToastStore.getState().show('未找到与现有笔记的关联', 'info');
      }
    } finally {
      setLinking(false);
    }
  };

  // 猜你还想搜索：根据检索词从已有笔记标题与最近搜索里推荐
  const suggestions = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    const set = new Set<string>();
    for (const note of notes) {
      const t = note.title.toLowerCase();
      if (!q || t.includes(q)) set.add(note.title);
    }
    for (const item of history) {
      if (!q || item.toLowerCase().includes(q)) set.add(item);
    }
    return [...set].slice(0, 5);
  }, [query, notes, history]);

  // 时间线：按月 → 按日 分组，最近在前（左栏简洁列表用）
  interface DayGroup {
    dayLabel: string;
    notes: Note[];
  }
  interface MonthGroup {
    monthLabel: string;
    yearMonth: string;
    days: DayGroup[];
    count: number;
  }
  const timeline = useMemo<MonthGroup[]>(() => {
    const sorted = [...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const months = new Map<string, MonthGroup>();
    for (const note of sorted) {
      const d = new Date(note.createdAt);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      let month = months.get(monthKey);
      if (!month) {
        month = {
          monthLabel: `${d.getFullYear()}年${d.getMonth() + 1}月`,
          yearMonth: monthKey,
          days: [],
          count: 0,
        };
        months.set(monthKey, month);
      }
      month.count += 1;
      let day = month.days.find((g) => g.dayLabel === `${d.getMonth() + 1}月${d.getDate()}日`);
      if (!day) {
        day = { dayLabel: `${d.getMonth() + 1}月${d.getDate()}日`, notes: [] };
        month.days.push(day);
      }
      day.notes.push(note);
    }
    return [...months.values()].sort((a, b) => (a.monthLabel < b.monthLabel ? 1 : -1));
  }, [notes]);

  const handleSaveExternal = async (url: string, index: number) => {
    const result = externalResults.find((item) => item.url === url);
    if (!result) return;
    setSavingIndex(index);
    setSavedHint('');
    try {
      await importExternalResult(result);
      setSavedHint(`「${result.title.slice(0, 20)}」已保存为笔记`);
    } finally {
      setSavingIndex(null);
    }
  };

  // 只有桌面端（Tauri）有文件系统权限
  const canPickFile = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const pickAndImportFile = async () => {
    if (importingFile || !canPickFile) return;
    setImportingFile(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        title: '导入笔记',
        filters: [{ name: '文档', extensions: ['md', 'markdown', 'txt', 'text', 'pdf', 'epub', 'mobi', 'azw3'] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      const { invoke } = await import('@tauri-apps/api/core');
      const importPath = await invoke<string>('file_import_into_data_dir', { path });
      await importNote({ kind: 'path', path: importPath, tags: parseImportTags() });
    } finally {
      setImportingFile(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 笔记列表/搜索卡片的链接徽章依赖 linkCounts：面板打开时刷新一次
  useEffect(() => {
    void useKnowledgeLinkStore.getState().refresh();
  }, []);

  // 读取目录里的文档清单：目录配置变化时刷新
  useEffect(() => {
    let cancelled = false;
    void listReadableDocs().then((docs) => {
      if (!cancelled) setReadableDocs(docs);
    });
    return () => {
      cancelled = true;
    };
  }, [readDirs]);

  const importReadableDoc = async (doc: ReadableDoc) => {
    if (importingDoc) return;
    setImportDocError('');
    setImportingDoc(doc.path);
    try {
      await importNote({ kind: 'path', path: doc.path, tags: parseImportTags() });
      setSavedHint(`「${doc.name.slice(0, 24)}」已导入`);
    } catch (error) {
      setImportDocError(describeError(error));
    } finally {
      setImportingDoc(null);
    }
  };

  // 导入草稿未提交时标记未完成
  useEffect(() => {
    usePanelDirty.getState().setDirty('knowledge', draft.trim().length > 0);
  }, [draft]);

  const submitSearch = (value?: string) => {
    void search(value ?? keyword);
  };

  const submitImport = async () => {
    if (!draft.trim()) return;
    await importNote({ kind: 'text', content: draft, title: title.trim() || undefined, tags: parseImportTags() });
    setDraft('');
    setTitle('');
    setImportTags('');
  };

  return (
    <div className="cozy-knowledge">
      <div className="cozy-mode-toggle" role="group" aria-label="视图切换">
        <button
          type="button"
          className="cozy-mode-toggle__item"
          data-active={viewMode === 'search'}
          aria-pressed={viewMode === 'search'}
          onClick={() => setViewMode('search')}
        >
          {t('检索')}
        </button>
        <button
          type="button"
          className="cozy-mode-toggle__item"
          data-active={viewMode === 'notes'}
          aria-pressed={viewMode === 'notes'}
          onClick={() => setViewMode('notes')}
        >
          {t('笔记整理')}
        </button>
        <button
          type="button"
          className="cozy-mode-toggle__item"
          data-active={viewMode === 'import'}
          aria-pressed={viewMode === 'import'}
          onClick={() => setViewMode('import')}
        >
          {t('快速导入')}
        </button>
      </div>

      {viewMode === 'notes' ? (
        <div className="cozy-notes-split">
          {/* 左栏：时间线（按月 → 按日分组，标题链接），点击在右栏预览 */}
          <div className="cozy-notes-split__list">
            <h3 className="panel-section-title">{t('笔记（{0}）', notes.length)}</h3>
            {notes.length === 0 ? (
              <p className="cozy-today-empty">{t('还没有笔记。去「快速导入」添加一条。')}</p>
            ) : (
              timeline.map((month) => (
                <section key={month.yearMonth} className="cozy-timeline__month">
                  <h4 className="cozy-timeline__month-title">
                    {month.monthLabel}
                    <span className="cozy-timeline__count">{t('{0} 条', month.count)}</span>
                  </h4>
                  {month.days.map((day) => (
                    <div key={day.dayLabel} className="cozy-timeline__day">
                      <span className="cozy-timeline__day-label">{day.dayLabel}</span>
                      <ul className="cozy-timeline__notes">
                        {day.notes.map((note) => (
                          <li key={note.id}>
                            <button
                              type="button"
                              className="cozy-link"
                              data-active={note.id === selectedNoteId}
                              onClick={() => setSelectedNoteId(note.id)}
                            >
                              {note.title || '（无标题笔记）'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>

          {/* 右栏：选中笔记的正文预览 */}
          <div className="cozy-notes-split__detail">
            {selectedNote ? (
              <>
                <div className="cozy-notes-split__head">
                  <h3 className="panel-section-title">{selectedNote.title}</h3>
                  <button
                    type="button"
                    className="cozy-btn-ghost"
                    onClick={() => void deleteNote(selectedNote.id)}
                  >
                    {t('删除')}
                  </button>
                </div>
                <NoteViewer
                  key={selectedNote.id}
                  content={selectedNote.content}
                  pageRanges={selectedNote.pageRanges}
                />
              </>
            ) : (
              <p className="cozy-today-empty">{t('从左侧选择一篇笔记查看内容。')}</p>
            )}
          </div>
        </div>
      ) : viewMode === 'import' ? (
        <div className="cozy-knowledge-import">
          <h3 className="panel-section-title">{t('快速导入')}</h3>
          <div className="cozy-knowledge-import__row">
            <input
              className="cozy-knowledge-import__title"
              type="text"
              placeholder={t('标题（留空取正文第一行）')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="cozy-knowledge-import__row">
            <label className="sr-only" htmlFor="knowledge-tags">
              {t('标签（用逗号分隔，检索会优先匹配）')}
            </label>
            <input
              id="knowledge-tags"
              className="cozy-knowledge-import__title"
              type="text"
              placeholder={t('标签（逗号分隔，如：数学,笔记方法）')}
              value={importTags}
              onChange={(event) => setImportTags(event.target.value)}
            />
          </div>
          <div className="cozy-knowledge-import__row">
            <label className="sr-only" htmlFor="knowledge-paste">
              {t('粘贴或输入笔记内容')}
            </label>
            <textarea
              id="knowledge-paste"
              className="cozy-knowledge-import__body"
              placeholder={t('粘贴或输入笔记内容')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <div className="cozy-knowledge-import__actions">
            <button
              type="button"
              className="cozy-btn-primary"
              disabled={!draft.trim()}
              onClick={() => void submitImport()}
            >
              <Plus size={15} strokeWidth={2} aria-hidden={true} />
              {t('导入')}
            </button>
            <button
              type="button"
              className="cozy-btn-secondary"
              disabled={!canPickFile || importingFile}
              title={canPickFile ? undefined : t('桌面端（Tauri）可选择本地文件')}
              onClick={() => void pickAndImportFile()}
            >
              {importingFile ? t('导入中…') : t('选择文件…')}
            </button>
          </div>
          <p className="cozy-knowledge-hint">
            {t('支持粘贴文本，或桌面端选择 PDF / Markdown / TXT / EPUB / MOBI / AZW3 文件；导入后会在后台切块并建索引。')}
          </p>

          <div className="cozy-knowledge-dirs">
            <h4 className="panel-section-title">{t('从读取目录导入')}</h4>
            {readDirs.length === 0 ? (
              <p className="cozy-knowledge-hint">
                {t('未配置读取目录。到 设置 → 路径 添加后，这里会列出目录里的文档。')}
              </p>
            ) : readableDocs.length === 0 ? (
              <p className="cozy-knowledge-hint">{t('读取目录里没有可导入的文档。')}</p>
            ) : (
              <ul className="cozy-knowledge-docs">
                {readableDocs.map((doc) => (
                  <li key={doc.path} className="cozy-knowledge-docs__item">
                    <span className="cozy-knowledge-docs__name" title={doc.path}>
                      {doc.name}
                    </span>
                    <span className="cozy-knowledge-docs__dir">
                      {doc.dir.split(/[\\/]/).pop()}
                    </span>
                    <button
                      type="button"
                      className="cozy-btn-secondary"
                      disabled={Boolean(importingDoc)}
                      onClick={() => void importReadableDoc(doc)}
                    >
                      {importingDoc === doc.path ? t('导入中…') : t('导入')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {importDocError ? <p className="cozy-today-error">{importDocError}</p> : null}
          </div>
        </div>
      ) : (
      <>
      <div className="cozy-search">
        <Search size={18} strokeWidth={2} aria-hidden={true} className="cozy-search__icon" />
        <label className="sr-only" htmlFor="knowledge-search">{t('搜索笔记')}</label>
        <input
          id="knowledge-search"
          className="cozy-search__input"
          type="text"
          placeholder={t('搜索笔记、概念或问题')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitSearch();
          }}
        />
        <button
          type="button"
          className="cozy-search__submit"
          aria-label={t('搜索')}
          onClick={() => submitSearch()}
        >
          <ArrowRight size={18} strokeWidth={2} aria-hidden={true} />
        </button>
      </div>

      <div className="cozy-search__actions">
        <label className="cozy-deep-toggle" title={t('用本地模型改写查询（Multi-Query + HyDE），更准但更慢')}>
          <input
            type="checkbox"
            checked={deep}
            onChange={(event) => setDeep(event.target.checked)}
          />
          <span>{t('深度检索')}</span>
        </label>
        <button
          type="button"
          className="cozy-btn-primary cozy-deep-ask"
          disabled={!keyword.trim() || asking}
          title={t('用本地模型检索相关笔记，生成带引用的深度回答')}
          onClick={() => void askQuestion(keyword)}
        >
          {asking ? t('回答中…') : t('深度回答')}
        </button>
      </div>

      {localLowConfidence && hits.length > 0 ? (
        <p className="cozy-knowledge-hint" role="status">
          {t('本地结果相关度偏低，可尝试开启「深度检索」或换个说法。')}
        </p>
      ) : null}

      {history.length > 0 ? (
        <div className="cozy-chip-row" aria-label="最近搜索">
          {history.map((chip) => (
            <button
              key={chip}
              type="button"
              className="cozy-chip"
              onClick={() => {
                setKeyword(chip);
                submitSearch(chip);
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="cozy-suggest" aria-label={t('猜你还想搜索')}>
          <span className="cozy-suggest__label">{t('猜你还想搜索')}</span>
          {suggestions.map((term) => (
            <button
              key={term}
              type="button"
              className="cozy-chip"
              onClick={() => {
                setKeyword(term);
                submitSearch(term);
              }}
            >
              {term}
            </button>
          ))}
        </div>
      ) : null}

      {query ? (
        <button type="button" className="cozy-btn-ghost cozy-knowledge__clear" onClick={clearSearch}>
          {t('清空搜索')}
        </button>
      ) : null}

      {blockedReason ? (
        <p className="cozy-knowledge-hint">{t('只搜了本地：{0}', blockedReason)}</p>
      ) : null}
      {searching ? <p className="cozy-knowledge-hint">{t('正在检索…')}</p> : null}
      {savedHint ? <p className="cozy-knowledge-hint">{savedHint}</p> : null}
      {error ? <p className="cozy-today-error">{error}</p> : null}

      {asking || deepAnswer ? (
        <div className="cozy-deep-answer">
          {asking ? (
            streamingAnswer ? (
              <p className="cozy-deep-answer__body cozy-deep-answer__body--streaming">
                {streamingAnswer}
              </p>
            ) : (
              <p className="cozy-knowledge-hint">{t('正在深入检索笔记并组织回答…')}</p>
            )
          ) : deepAnswer ? (
            deepAnswer.empty ? (
              <p className="cozy-knowledge-hint">{t('没找到相关笔记，换个说法试试。')}</p>
            ) : (
              <>
                <div className="cozy-deep-answer__head">
                  <h3 className="panel-section-title">{t('深度回答')}</h3>
                  <span className="cozy-deep-answer__conf" title={t('自我评判的置信度')}>
                    {t('置信度 {0}%', Math.round(deepAnswer.confidence * 100))}
                  </span>
                  {deepAnswer.regenerated ? (
                    <span className="cozy-deep-answer__badge">{t('已二次修正')}</span>
                  ) : null}
                  {!deepAnswer.judged ? (
                    <span className="cozy-deep-answer__badge">{t('未评判')}</span>
                  ) : null}
                </div>
                {!deepAnswer.ok ? (
                  <p className="cozy-knowledge-hint">
                    {t('本地模型暂不可用，以下是相关笔记片段（未生成完整回答）。')}
                  </p>
                ) : null}
                <p className="cozy-deep-answer__body">{deepAnswer.answer}</p>
                {deepAnswer.critique ? (
                  <p className="cozy-knowledge-hint">{t('评判意见：{0}', deepAnswer.critique)}</p>
                ) : null}
                {deepAnswer.confidence < 0.4 ? (
                  <p className="cozy-knowledge-hint">
                    {t('模型把握偏低，建议对照下方引用来源自行核实。')}
                  </p>
                ) : null}
                {deepAnswer.citations.length > 0 ? (
                  <>
                    <h4 className="cozy-deep-answer__cites-title">{t('引用来源')}</h4>
                    <ul className="cozy-hit-list">
                      {deepAnswer.citations.map((hit) => {
                        const note = notes.find((n) => n.id === hit.noteId);
                        return (
                          <li key={hit.chunkId} className="cozy-note-card">
                            <p className="cozy-note-card__source">
                              <strong>{note?.title ?? '未知笔记'}</strong>
                              {hit.headingPath && hit.headingPath.length > 0 ? (
                                <span className="cozy-heading-path">
                                  {' · '}
                                  {hit.headingPath.join(' / ')}
                                </span>
                              ) : null}
                            </p>
                            <button
                              type="button"
                              className="cozy-note-card__excerpt cozy-link"
                              title={t('点开查看完整内容')}
                              onClick={() => openHit(hit.noteId, hit.charStart, hit.text)}
                            >
                              {hit.text}
                            </button>
                            <p className="cozy-note-card__hint">
                              {t('相关度 {0} · 点击段落查看所属笔记', hit.score.toFixed(2))}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}
              </>
            )
          ) : null}
        </div>
      ) : null}

      {query && !searching ? (
        hits.length === 0 && !confirmationRequired && !externalSearchAttempted ? (
          <div className="cozy-knowledge-empty">
            <p>{t('本地没找到相关内容。')}</p>
            {externalSearchAvailable ? (
              <button type="button" className="cozy-btn-primary" onClick={() => void confirmExternalSearch()}>
                {t('搜索网络')}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {enhancing ? (
              <p className="cozy-knowledge-hint">{t('正在用模型整理结果…')}</p>
            ) : null}
            <ul className="cozy-hit-list">
              {[...hits]
                .sort(
                  (a, b) =>
                    (enhancements[`hit:${a.chunkId}`]?.rank ?? 999) -
                    (enhancements[`hit:${b.chunkId}`]?.rank ?? 999),
                )
                .map((hit) => {
                  const enh = enhancements[`hit:${hit.chunkId}`];
                  const note = notes.find((n) => n.id === hit.noteId);
                  return (
                    <li key={hit.chunkId} className="cozy-note-card">
                      {enh && enh.rank > 0 ? (
                        <span className="cozy-rank-badge">#{enh.rank}</span>
                      ) : null}
                      <p className="cozy-note-card__source">
                        <strong>{note?.title ?? '未知笔记'}</strong>
                        {hit.headingPath && hit.headingPath.length > 0 ? (
                          <span className="cozy-heading-path">
                            {' · '}
                            {hit.headingPath.join(' / ')}
                          </span>
                        ) : null}
                      </p>
                      {enh?.summary ? (
                        <p className="cozy-note-card__ai">{enh.summary}</p>
                      ) : null}
                      <button
                        type="button"
                        className="cozy-note-card__excerpt cozy-link"
                        title={t('点开查看完整内容')}
                        onClick={() => openHit(hit.noteId, hit.charStart, hit.text)}
                      >
                        {hit.text}
                      </button>
                      <p className="cozy-note-card__hint">
                        {t('相关度 {0} · 点击段落查看所属笔记', hit.score.toFixed(2))}
                        {(linkCounts[hit.noteId] ?? 0) > 0 ? (
                          <span
                            className="cozy-link-badge cozy-link-badge--inline"
                            title={t('这篇笔记与 {0} 篇内容有关联', linkCounts[hit.noteId])}
                          >
                            <Link2 size={12} strokeWidth={2} aria-hidden={true} />
                            {t('{0} 关联', linkCounts[hit.noteId])}
                          </span>
                        ) : null}
                      </p>
                    </li>
                  );
                })}
            </ul>
          </>
        )
      ) : null}

      {confirmationRequired ? (
        <div className="cozy-knowledge-confirm">
          <p className="cozy-knowledge-hint">
            {t('本地结果不足，需要联网搜索补充。只会发送关键词，不会上传笔记原文。')}
          </p>
          <button type="button" className="cozy-btn-primary" onClick={() => void confirmExternalSearch()}>
            {t('确认搜索网络')}
          </button>
        </div>
      ) : null}

      {externalSearchAttempted && externalResults.length > 0 ? (
        <div className="cozy-knowledge-external">
          <h3 className="panel-section-title">{t('外部搜索结果')}</h3>
          <ul className="cozy-hit-list">
            {[...externalResults]
              .sort(
                (a, b) =>
                  (enhancements[`ext:${a.url}`]?.rank ?? 999) -
                  (enhancements[`ext:${b.url}`]?.rank ?? 999),
              )
              .map((result, index) => {
                const enh = enhancements[`ext:${result.url}`];
                return (
                  <li key={result.url} className="cozy-note-card">
                    {enh && enh.rank > 0 ? (
                      <span className="cozy-rank-badge">#{enh.rank}</span>
                    ) : null}
                    <button
                      type="button"
                      className="cozy-note-card__title cozy-link"
                      title="点开观看具体内容"
                      onClick={() => void openExternal(result.url)}
                    >
                      {result.title}
                    </button>
                    {enh?.summary ? (
                      <p className="cozy-note-card__ai">{enh.summary}</p>
                    ) : null}
                    {result.snippet ? (
                      <p className="cozy-note-card__excerpt">{result.snippet}</p>
                    ) : null}
                    {enh?.reason ? (
                      <p className="cozy-note-card__reason">
                        {t('教练推荐：{0}', enh.reason)}
                      </p>
                    ) : null}
                    <p className="cozy-note-card__source">
                      {result.site} · {t('相关度 {0}', result.score.toFixed(2))}
                    </p>
                    <button
                      type="button"
                      className="cozy-btn-secondary cozy-save-note"
                      onClick={() => void handleSaveExternal(result.url, index)}
                    >
                      <BookMarked size={14} strokeWidth={1.75} aria-hidden={true} />
                      {savingIndex === index ? t('保存中…') : t('保存为笔记')}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : null}

      {askHistory.length > 0 ? (
        <div className="cozy-ask-history">
          <div className="cozy-ask-history__head">
            <h3 className="panel-section-title">{t('问答历史（{0}）', askHistory.length)}</h3>
            {askHistoryLoading ? (
              <span className="cozy-knowledge-hint">{t('刷新中…')}</span>
            ) : null}
          </div>
          <ul className="cozy-hit-list">
            {askHistory.map((session) => (
              <li key={session.id} className="cozy-note-card">
                <p className="cozy-note-card__title">{session.question}</p>
                <p className="cozy-note-card__excerpt">{session.answer.slice(0, 120)}</p>
                <div className="cozy-note-card__actions">
                  <span className="cozy-note-card__source">
                    {t('置信度 {0}%', Math.round(session.confidence * 100))}
                    {' · '}
                    {new Date(session.createdAt).toLocaleString(
                      language === 'en' ? 'en-US' : 'zh-CN',
                      { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                    )}
                  </span>
                  <button
                    type="button"
                    className="cozy-btn-ghost"
                    onClick={() => void deleteAskHistory(session.id)}
                  >
                    {t('删除')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      </>
      )}

      {/* 本地检索命中：点开查看完整内容 */}
      <Modal
        dismissible
        onClose={() => setViewingNote(null)}
        open={viewingNote !== null}
        title={viewingNote?.title ?? t('笔记')}
      >
        {viewingNote ? (
          <>
            <NoteViewer
              content={viewingNote.content}
              pageRanges={viewingNote.pageRanges}
              initialCharStart={viewingNoteStart}
              initialAnchor={viewingNoteAnchor}
            />
            {/* 标签：可编辑（增删后直接保存；标签是检索的重要依据） */}
            <div className="cozy-tag-editor">
              <h4 className="panel-section-title">{t('标签')}</h4>
              {viewingNote.tags.length > 0 ? (
                <div className="cozy-tag-row">
                  {viewingNote.tags.map((tag) => (
                    <span key={tag} className="cozy-tag-chip">
                      {tag}
                      <button
                        type="button"
                        className="cozy-tag-chip__remove"
                        aria-label={t('移除标签 {0}', tag)}
                        onClick={() => {
                          const next = viewingNote.tags.filter((item) => item !== tag);
                          setViewingNote({ ...viewingNote, tags: next });
                          void updateNote(viewingNote.id, { tags: next });
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="cozy-knowledge-hint">{t('还没有标签。加上标签后检索会更准。')}</p>
              )}
              <div className="cozy-tag-editor__add">
                <input
                  className="cozy-knowledge-import__title"
                  type="text"
                  placeholder={t('新增标签，回车添加')}
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const tag = tagDraft.trim();
                    if (!tag) return;
                    const next = [...viewingNote.tags];
                    if (!next.includes(tag)) next.push(tag);
                    setTagDraft('');
                    setViewingNote({ ...viewingNote, tags: next });
                    void updateNote(viewingNote.id, { tags: next });
                  }}
                />
              </div>
            </div>
            {/* 查找关联：对已有笔记手动触发 AI 关联建议（导入时没建或错过确认的补回来） */}
            <div className="cozy-related-notes">
              <div className="cozy-relate-actions">
                <h4 className="panel-section-title">{t('知识关联')}</h4>
                <button
                  type="button"
                  className="cozy-btn-secondary"
                  disabled={linking}
                  title={t('用本地模型检索相关旧笔记并建议建链')}
                  onClick={() => void relinkNote(viewingNote.id)}
                >
                  {linking ? t('查找中…') : t('查找关联笔记')}
                </button>
              </div>
              {related.length > 0 ? (
                <ul className="cozy-related-notes__list">
                  {related.map((item) => (
                    <li key={item.noteId}>
                      <button
                        type="button"
                        className="cozy-related-notes__item"
                        onClick={() => openHit(item.noteId)}
                      >
                        <span className="cozy-related-notes__tag">
                          {RELATION_LABELS[item.relationType as keyof typeof RELATION_LABELS] ?? item.relationType}
                        </span>
                        <span>{item.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cozy-knowledge-hint">
                  {t('还没有已确认的关联。点「查找关联笔记」让 AI 检索相关旧笔记。')}
                </p>
              )}
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
