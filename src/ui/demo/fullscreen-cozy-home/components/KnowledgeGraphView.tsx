/**
 * 知识图谱视图 —— 把用户确认过的知识链接画成图。
 *
 * 数据来自 knowledge-link-store.graph（queryKnowledgeLinks.executeAsGraph 已把
 * 边组装成节点集，含 degree）。这里只做展示：
 * - 节点按 degree 定大小（连接越多的笔记越大）
 * - 边带关系类型标签（同一概念/前置知识/延伸…）
 * - 点击节点高亮邻居 + 打开详情（笔记正文 / 任务信息）
 *
 * 布局用简单的圆形排布（确定性、无第三方依赖），节点少时足够清晰；
 * 以后要力导向/缩放平移再换实现。
 */
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../../i18n';
import { useKnowledgeLinkStore, RELATION_LABELS } from '../../../stores/knowledge-link-store';
import { useToastStore } from '../../../stores/toast-store';
import { Modal } from '../../../components/common/Modal';
import { NoteViewer } from '../../../components/features/NoteViewer';
import { repositories } from '../../../stores/runtime';
import type { Note } from '@shared-types/domain';
import type { Todo } from '@shared-types/domain';
import type { LinkRelationType } from '@shared-types/domain';

const SIZE = 520; // 画布边长
const CENTER = SIZE / 2;
const RADIUS = 200;

/** 详情弹窗要展示的内容：note 有全文，todo 有标题/状态 */
interface NodeDetail {
  type: string;
  id: string;
  label: string;
  note?: Note;
  todo?: Todo;
  /** 加载完成但实体不存在（链接指向的笔记已删除） */
  notFound?: boolean;
}

export function KnowledgeGraphView() {
  const t = useT();
  const graph = useKnowledgeLinkStore((state) => state.graph);
  const selected = useKnowledgeLinkStore((state) => state.selected);
  const select = useKnowledgeLinkStore((state) => state.select);
  const relationFilter = useKnowledgeLinkStore((state) => state.relationFilter);
  const toggleRelation = useKnowledgeLinkStore((state) => state.toggleRelation);
  const includeArchived = useKnowledgeLinkStore((state) => state.includeArchived);
  const setIncludeArchived = useKnowledgeLinkStore((state) => state.setIncludeArchived);
  const refresh = useKnowledgeLinkStore((state) => state.refresh);
  const loading = useKnowledgeLinkStore((state) => state.loading);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
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
  }, [refresh]);

  // 点击节点：高亮邻居 + 打开详情（异步拉笔记正文 / 任务信息 / 关联）
  const openNode = (node: { type: string; id: string; label: string }) => {
    select({ type: node.type as never, id: node.id });
    setDetail({ type: node.type, id: node.id, label: node.label });
    setRelated([]);
    setConnectTo('');
    if (node.type === 'note') {
      void repositories.note.findById(node.id).then((note) => {
        setDetail((prev) =>
          prev && prev.id === node.id
            ? { ...prev, note: note ?? undefined, notFound: note === null }
            : prev
        );
      });
      void useKnowledgeLinkStore.getState().relatedNotes(node.id).then(setRelated);
      // 可手动连接的目标：图谱里已出现的其他笔记节点（排除自己）。
      // 用 findByIds 拉真实标题（不整表 listAll——笔记上百时会截断）。
      const peerIds = graph.nodes
        .filter((n) => n.type === 'note' && n.id !== node.id)
        .map((n) => n.id);
      void repositories.note.findByIds(peerIds).then((notes) => {
        setTargetNotes(notes.map((n) => ({ id: n.id, title: n.title || '（无标题笔记）' })));
      });
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
      setRelated(fresh);
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
    setRelated(fresh);
    useToastStore.getState().show('已删除这条关联', 'info');
  };

  /** 手动连接：当前节点 → 目标笔记 + 关系类型 */
  const createManualLink = async () => {
    if (!detail || detail.type !== 'note' || !connectTo) return;
    await useKnowledgeLinkStore.getState().createLink({
      fromType: 'note',
      fromId: detail.id,
      toType: 'note',
      toId: connectTo,
      relationType: connectRelation,
    });
    await useKnowledgeLinkStore.getState().refresh();
    const fresh = await useKnowledgeLinkStore.getState().relatedNotes(detail.id);
    setRelated(fresh);
    setConnectTo('');
    useToastStore.getState().show('已建立关联', 'ok');
  };

  // 圆形排布：节点按 degree 降序放，连接多的靠近中心
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const nodes = graph.nodes;
    const n = nodes.length;
    nodes.forEach((node, index) => {
      const angle = (index / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
      // 连接多的节点放大且更靠近中心
      const shrink = node.degree > 1 ? 0.75 : 1;
      const r = RADIUS * shrink;
      map.set(`${node.type}:${node.id}`, {
        x: CENTER + Math.cos(angle) * r,
        y: CENTER + Math.sin(angle) * r,
      });
    });
    return map;
  }, [graph.nodes]);

  // 过滤：relationType 多选
  const visibleLinks = useMemo(
    () =>
      relationFilter.length > 0
        ? graph.links.filter((link) => relationFilter.includes(link.relationType))
        : graph.links,
    [graph.links, relationFilter],
  );

  const nodeKey = (type: string, id: string): string => `${type}:${id}`;
  const selectedKey = selected ? nodeKey(selected.type, selected.id) : undefined;
  // 选中节点的邻居 id（高亮用）
  const neighborKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!selectedKey) return keys;
    for (const link of visibleLinks) {
      const from = nodeKey(link.fromType, link.fromId);
      const to = nodeKey(link.toType, link.toId);
      if (from === selectedKey) keys.add(to);
      if (to === selectedKey) keys.add(from);
    }
    return keys;
  }, [visibleLinks, selectedKey]);

  if (loading && graph.nodes.length === 0) {
    return <p className="cozy-today-empty">{t('加载中…')}</p>;
  }
  if (graph.nodes.length === 0) {
    return (
      <p className="cozy-today-empty">
        {t('还没有知识关联。导入笔记并确认「相关旧笔记」建议后，关系会显示在这里。')}
      </p>
    );
  }

  return (
    <div className="cozy-graph">
      <div className="cozy-graph__toolbar">
        <label className="cozy-graph__filter-label">{t('关系')}</label>
        {(Object.keys(RELATION_LABELS) as (keyof typeof RELATION_LABELS)[]).map((rel) => (
          <button
            key={rel}
            type="button"
            className="cozy-graph__chip"
            data-active={relationFilter.includes(rel)}
            onClick={() => void toggleRelation(rel)}
          >
            {RELATION_LABELS[rel]}
          </button>
        ))}
        <label className="cozy-graph__archived">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => void setIncludeArchived(event.target.checked)}
          />
          {t('含已归档')}
        </label>
      </div>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="cozy-graph__canvas" role="img" aria-label={t('知识图谱')}>
        {/* 边：带关系标签 */}
        {visibleLinks.map((link, index) => {
          const from = positions.get(nodeKey(link.fromType, link.fromId));
          const to = positions.get(nodeKey(link.toType, link.toId));
          if (!from || !to) return null;
          const highlighted =
            selectedKey !== undefined &&
            (nodeKey(link.fromType, link.fromId) === selectedKey ||
              nodeKey(link.toType, link.toId) === selectedKey);
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          return (
            <g key={`${link.id}-${index}`} data-highlight={highlighted}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--hud-border-dark, #c8c6bb)"
                strokeWidth={highlighted ? 2 : 1}
                opacity={highlighted ? 1 : 0.6}
              />
              <text x={mx} y={my - 4} className="cozy-graph__edge-label" textAnchor="middle">
                {RELATION_LABELS[link.relationType] ?? link.relationType}
              </text>
            </g>
          );
        })}

        {/* 节点：连接多则更大 */}
        {graph.nodes.map((node) => {
          const key = nodeKey(node.type, node.id);
          const pos = positions.get(key);
          if (!pos) return null;
          const isSelected = key === selectedKey;
          const isNeighbor = selectedKey !== undefined && neighborKeys.has(key);
          const r = 8 + Math.min(node.degree, 6) * 2.5;
          return (
            <g key={key} data-highlight={isSelected || isNeighbor} opacity={selectedKey && !isSelected && !isNeighbor ? 0.35 : 1}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r}
                fill={node.type === 'note' ? 'var(--accent-soft, #e9c484)' : 'var(--wall, #f0eee5)'}
                stroke={isSelected ? 'var(--accent, #4a6b57)' : 'var(--hud-border-dark, #c8c6bb)'}
                strokeWidth={isSelected ? 2 : 1}
                cursor="pointer"
                onClick={() => openNode({ type: node.type, id: node.id, label: node.label })}
              >
                <title>{node.label}</title>
              </circle>
              <text x={pos.x} y={pos.y + r + 10} className="cozy-graph__node-label" textAnchor="middle">
                {node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 节点详情：点开看这篇笔记 / 这个任务是什么 */}
      <Modal
        dismissible
        onClose={() => setDetail(null)}
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
                <NoteViewer
                  content={detail.note.content}
                  pageRanges={detail.note.pageRanges}
                />
                {/* 知识关联管理：删除现有链接 / 查找关联 / 手动建链 */}
                <div className="cozy-related-notes">
                  <div className="cozy-relate-actions">
                    <h4 className="panel-section-title">{t('知识关联')}</h4>
                    <button
                      type="button"
                      className="cozy-btn-secondary"
                      disabled={relinking}
                      title={t('用本地模型/DeepSeek 检索相关旧笔记并建议建链')}
                      onClick={() => void relinkNote(detail.id)}
                    >
                      {relinking ? t('查找中…') : t('查找关联笔记')}
                    </button>
                  </div>

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
                              {RELATION_LABELS[item.relationType] ?? item.relationType}
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
                      {(Object.keys(RELATION_LABELS) as LinkRelationType[]).map((rel) => (
                        <option key={rel} value={rel}>
                          {RELATION_LABELS[rel]}
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
