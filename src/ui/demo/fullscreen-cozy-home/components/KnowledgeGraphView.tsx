/** Knowledge graph navigation and confirmed-link management. */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import { KnowledgeGraphExplorer } from '../../../components/features/graph/KnowledgeGraphExplorer';
import { GRAPH_RELATIONS } from '../../../components/features/graph/graph-model';
import { useKnowledgeOrganization } from '../../../hooks/use-knowledge-organization';
import { useKnowledgeLinkStore, RELATION_LABELS } from '../../../stores/knowledge-link-store';
import { useToastStore } from '../../../stores/toast-store';
import { Modal } from '../../../components/common/Modal';
import { NoteViewer } from '../../../components/features/NoteViewer';
import { RenameNote } from '../../../components/features/RenameNote';
import { StandardizeNote } from '../../../components/features/StandardizeNote';
import { NoteReferences } from '../../../components/features/NoteReferences';
import { describeError, eventBus, repositories } from '../../../stores/runtime';
import type { Note } from '@shared-types/domain';
import type { Todo } from '@shared-types/domain';
import type { LinkRelationType } from '@shared-types/domain';

/** 详情弹窗要展示的内容：note 有全文，todo 有标题/状态 */
interface NodeDetail {
  type: string;
  id: string;
  label: string;
  note?: Note;
  todo?: Todo;
  /** 加载完成但实体不存在（链接指向的笔记已删除） */
  notFound?: boolean;
  start?: number;
  anchor?: string;
}

export function KnowledgeGraphView() {
  const [history, setHistory] = useState<Array<{ type: string; id: string; label: string; start?: number; anchor?: string }>>([]);
  const position = useRef<{ offset: number; anchor?: string } | undefined>(undefined);
  const t = useT();
  const organizationBlocked = useKnowledgeOrganization();
  const graph = useKnowledgeLinkStore((state) => state.graph);
  const select = useKnowledgeLinkStore((state) => state.select);
  const refresh = useKnowledgeLinkStore((state) => state.refresh);
  const loading = useKnowledgeLinkStore((state) => state.loading);
  const error = useKnowledgeLinkStore((state) => state.error);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const detailId = useRef<string | undefined>(undefined);
  useEffect(() => () => { detailId.current = undefined; }, []);
  /** 当前节点的已确认关联（节点详情「知识关联」区块） */
  const [related, setRelated] = useState<
    Array<{ id: string; noteId: string; title: string; relationType: LinkRelationType }>
  >([]);
  /** 「查找关联」进行中 */
  const [relinking, setRelinking] = useState(false);
  /** 手动连接：目标笔记 + 关系类型 */
  const [connectTo, setConnectTo] = useState<string>('');
  const [connectRelation, setConnectRelation] = useState<LinkRelationType>('same_concept');
  /** 可连接的目标笔记（其他笔记） */
  const [targetNotes, setTargetNotes] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    void refresh();
    const off = (['NoteImported', 'NoteUpdated', 'NoteDeleted'] as const).map(type => eventBus.subscribe(type, () => { void refresh(); }));
    return () => off.forEach(stop => stop());
  }, [refresh]);

  // 点击节点：高亮邻居 + 打开详情（异步拉笔记正文 / 任务信息 / 关联）
  const openNode = (node: { type: string; id: string; label: string; start?: number; anchor?: string }, remember = true) => {
    if (remember && detail) setHistory(previous => [...previous.slice(-19), { type: detail.type, id: detail.id, label: detail.label, start: position.current?.offset ?? detail.start, anchor: position.current?.anchor ?? detail.anchor }]);
    position.current = undefined;
    select({ type: node.type as never, id: node.id });
    detailId.current = node.id;
    setDetail({ ...node });
    setRelated([]);
    setConnectTo('');
    if (node.type === 'note') {
      void repositories.note.findById(node.id).then((note) => {
        if (detailId.current !== node.id) return;
        setDetail((prev) =>
          prev && prev.id === node.id
            ? { ...prev, note: note ?? undefined, notFound: note === null }
            : prev
        );
      }).catch(error => { if (detailId.current === node.id) useToastStore.getState().show(describeError(error), 'error'); });
      void useKnowledgeLinkStore.getState().relatedNotes(node.id).then(items => {
        if (detailId.current === node.id) setRelated(items.filter(item => item.relationType !== 'review_later'));
      });
      setTargetNotes(graph.nodes.filter(item => item.type === 'note' && item.id !== node.id)
        .map(item => ({ id: item.id, title: item.label })));
    } else if (node.type === 'todo') {
      void repositories.todo.findById(node.id).then((todo) => {
        setDetail((prev) =>
          prev && prev.id === node.id
            ? { ...prev, todo: todo ?? undefined, notFound: todo === null }
            : prev
        );
      });
    }
  };

  /** 手动触发 AI 关联建议：对这篇笔记检索相关旧笔记，确认后建链并刷新图谱 */
  const relinkNote = async (noteId: string) => {
    setRelinking(true);
    try {
      const result = await useKnowledgeLinkStore.getState().suggestForNote(noteId);
      await useKnowledgeLinkStore.getState().refresh();
      const fresh = await useKnowledgeLinkStore.getState().relatedNotes(noteId);
      if (detailId.current === noteId) setRelated(fresh.filter(item => item.relationType !== 'review_later'));
      if (result.created.length > 0) {
        useToastStore.getState().show(`已建立 ${result.created.length} 条知识关联`, 'ok');
      } else if (result.suggested === 0) {
        useToastStore.getState().show('未找到与现有笔记的关联', 'info');
      }
    } finally {
      setRelinking(false);
    }
  };

  /** 删除一条已确认的链接（用户主动，归档即可撤销） */
  const removeLink = async (linkId: string, noteId: string) => {
    await useKnowledgeLinkStore.getState().archive(linkId);
    await useKnowledgeLinkStore.getState().refresh();
    const fresh = await useKnowledgeLinkStore.getState().relatedNotes(noteId);
    if (detailId.current === noteId) setRelated(fresh.filter(item => item.relationType !== 'review_later'));
    useToastStore.getState().show('已删除这条关联', 'info');
  };

  /** 手动连接：当前节点 → 目标笔记 + 关系类型 */
  const createManualLink = async () => {
    if (!detail || detail.type !== 'note' || !connectTo) return;
    const noteId = detail.id;
    await useKnowledgeLinkStore.getState().createLink({
      fromType: 'note',
      fromId: noteId,
      toType: 'note',
      toId: connectTo,
      relationType: connectRelation,
    });
    await useKnowledgeLinkStore.getState().refresh();
    const fresh = await useKnowledgeLinkStore.getState().relatedNotes(noteId);
    if (detailId.current === noteId) setRelated(fresh.filter(item => item.relationType !== 'review_later'));
    setConnectTo('');
    useToastStore.getState().show('已建立关联', 'ok');
  };

  return (
    <div className="cozy-graph">
      {error && <p role="alert">{t(error)}</p>}
      <KnowledgeGraphExplorer graph={graph} loading={loading} error={error} onRefresh={() => void refresh()} onOpen={openNode} />
      {/* 节点详情：点开看这篇笔记 / 这个任务是什么 */}
      <Modal
        dismissible
        onClose={() => { detailId.current = undefined; setDetail(null); setHistory([]); }}
        open={detail !== null}
        title={detail?.label ?? ''}
      >
        {detail ? (
          detail.notFound ? (
            <p className="cozy-knowledge-hint">
              {t('这篇内容已被删除，关系仍保留在记录中。')}
            </p>
          ) : detail.type === 'note' ? (
            detail.note ? (
              <>
                {history.length > 0 && <button type="button" className="cozy-btn-secondary" onClick={() => {
                  const previous = history[history.length - 1]; setHistory(items => items.slice(0, -1)); openNode(previous, false);
                }}>{t('返回上一笔记')}</button>}
                <RenameNote key={`rename-${detail.id}`} note={detail.note} onSaved={note => {
                  if (detailId.current === note.id) setDetail(current => current ? { ...current, label: note.title, note } : current);
                  void refresh();
                }} />
                <StandardizeNote key={`standard-${detail.id}`} note={detail.note} onOpen={note => openNode({ type: 'note', id: note.id, label: note.title })} />
                <NoteViewer
                  key={detail.id}
                  onOpenNote={note => openNode({ type: 'note', id: note.id, label: note.title })}
                  content={detail.note.content}
                  pageRanges={detail.note.pageRanges}
                  initialCharStart={detail.start} initialAnchor={detail.anchor}
                  onReadingPosition={value => { position.current = value; }}
                />
                <NoteReferences key={`references-${detail.id}`} noteId={detail.id} onOpen={(note, start, anchor) => openNode({ type: 'note', id: note.id, label: note.title, start, anchor })} />
                {/* 知识关联管理：删除现有链接 / 查找关联 / 手动建链 */}
                <div className="cozy-related-notes">
                  <div className="cozy-relate-actions">
                    <h4 className="panel-section-title">{t('知识关联')}</h4>
                    <button
                      type="button"
                      className="cozy-btn-secondary"
                      disabled={relinking || Boolean(organizationBlocked)}
                      title={t(organizationBlocked ?? '仅使用 DeepSeek 分析相关笔记，确认后建立关联')}
                      onClick={() => void relinkNote(detail.id)}
                    >
                      {relinking ? t('查找中…') : t('查找关联笔记')}
                    </button>
                  </div>
                  {organizationBlocked && <p className="cozy-knowledge-hint">{t(organizationBlocked)}</p>}
                  {related.length > 0 ? (
                    <ul className="cozy-related-notes__list">
                      {related.map((item) => (
                        <li key={item.id} className="cozy-related-notes__row">
                          <button
                            type="button"
                            className="cozy-related-notes__item"
                            onClick={() => openNode({ type: 'note', id: item.noteId, label: item.title })}
                          >
                            <span className="cozy-related-notes__tag">
                              {t(RELATION_LABELS[item.relationType] ?? item.relationType)}
                            </span>
                            <span>{item.title}</span>
                          </button>
                          <button
                            type="button"
                            className="cozy-btn-ghost cozy-related-notes__remove"
                            title={t('删除这条关联')}
                            onClick={() => void removeLink(item.id, detail.id)}
                          >
                            {t('删除')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cozy-knowledge-hint">
                      {t('还没有已确认的关联。点「查找关联笔记」让 AI 检索，或手动连接：')}
                    </p>
                  )}

                  {/* 手动连接：选目标笔记 + 关系类型 */}
                  <div className="cozy-relate-manual">
                    <select
                      className="cozy-model-field__input"
                      value={connectTo}
                      onChange={(event) => setConnectTo(event.target.value)}
                    >
                      <option value="">{t('选择要连接的笔记…')}</option>
                      {targetNotes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.title}
                        </option>
                      ))}
                    </select>
                    <select
                      className="cozy-model-field__input"
                      value={connectRelation}
                      onChange={(event) => setConnectRelation(event.target.value as LinkRelationType)}
                    >
                      {GRAPH_RELATIONS.map((rel) => (
                        <option key={rel} value={rel}>
                          {t(RELATION_LABELS[rel])}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="cozy-btn-primary"
                      disabled={!connectTo}
                      onClick={() => void createManualLink()}
                    >
                      {t('建立关联')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="cozy-knowledge-hint">{t('正在加载笔记内容…')}</p>
            )
          ) : detail.type === 'todo' ? (
            detail.todo ? (
              <div className="cozy-graph__todo-detail">
                <p className="cozy-note-card__source">{detail.todo.title}</p>
                <p className="cozy-knowledge-hint">
                  {t('状态：{0}', detail.todo.status)}
                  {detail.todo.estimatedMinutes
                    ? t(' · 计划 {0} 分钟', detail.todo.estimatedMinutes)
                    : ''}
                </p>
              </div>
            ) : (
              <p className="cozy-knowledge-hint">{t('正在加载任务信息…')}</p>
            )
          ) : (
            <p className="cozy-knowledge-hint">
              {t('{0}（{1}）', detail.label, detail.id)}
            </p>
          )
        ) : null}
      </Modal>
    </div>
  );
}
