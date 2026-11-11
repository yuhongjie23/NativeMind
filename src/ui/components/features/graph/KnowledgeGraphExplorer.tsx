import { useEffect, useMemo } from 'react';
import type { LinkRelationType } from '@application/ports';
import { useT } from '../../../i18n';
import { RELATION_LABELS, type LabeledGraphNode, type LinkGraph } from '../../../stores/knowledge-link-store';
import { GRAPH_RELATIONS, projectNoteGraph } from './graph-model';
import { GraphCanvas } from './GraphCanvas';
import './knowledge-graph.css';
import { needsReadableTitle } from '@domain/note/title-quality';
import { useKnowledgeGraphViewStore } from '../../../stores/knowledge-graph-view-store';

export function KnowledgeGraphExplorer({ graph, onOpen, onRefresh, loading, error }: {
  graph: LinkGraph; onOpen: (node: LabeledGraphNode) => void; onRefresh: () => void; loading: boolean; error?: string;
}) {
  const t = useT();
  const query = useKnowledgeGraphViewStore(state => state.query);
  const relation = useKnowledgeGraphViewStore(state => state.relation);
  const showOrphans = useKnowledgeGraphViewStore(state => state.showOrphans);
  const selected = useKnowledgeGraphViewStore(state => state.selected);
  const local = useKnowledgeGraphViewStore(state => state.local);
  const depth = useKnowledgeGraphViewStore(state => state.depth);
  const selectionUnavailable = useKnowledgeGraphViewStore(state => state.selectionUnavailable);
  const setFilters = useKnowledgeGraphViewStore(state => state.setFilters);
  const setSelected = useKnowledgeGraphViewStore(state => state.select);
  const reset = useKnowledgeGraphViewStore(state => state.clearFilters);
  const reconcileSelection = useKnowledgeGraphViewStore(state => state.reconcileSelection);
  useEffect(() => {
    if (!loading && !error) reconcileSelection(new Set(graph.nodes
      .filter(item => item.type === 'note' && !needsReadableTitle(item.label)).map(item => item.id)));
  }, [graph, loading, error, reconcileSelection]);
  const center = local ? selected : undefined;
  const projected = useMemo(() => projectNoteGraph(graph, { query, relation, showOrphans, center, depth }),
    [graph, query, relation, showOrphans, center, depth]);
  const node = projected.nodes.find(item => item.id === selected);
  const connections = projected.edges.filter(edge => edge.source === selected || edge.target === selected);
  const titles = new Map(graph.nodes.map(item => [item.id, item.label]));
  const untitled = graph.nodes.filter(item => needsReadableTitle(item.label));
  return <section className="note-graph" aria-label={t('浏览笔记关系')}>
    <p className="note-graph__hint">{t('圆点是笔记，连线是已确认的知识关系。点击选中，双击打开原文。')}</p>
    <p className="note-graph__hint">{t('本次使用中会记住筛选、选中笔记和缩放位置。清除筛选或重置视图可重新开始。')}</p>
    {selectionUnavailable && <p role="status" className="note-graph__hint">{t('上次选中的笔记不在当前图谱中，已返回全局图谱。')}</p>}
    {untitled.length > 0 && <details className="note-graph__selection">
      <summary>{t('待整理标题：{0} 篇', untitled.length)}</summary>
      <p>{t('网址或域名暂不作为图谱节点名称。笔记仍保留；打开后可用 DeepSeek 整理标题，或手动命名。')}</p>
      <ul>{untitled.map(item => <li key={item.id}><button type="button" className="cozy-link" onClick={() => onOpen(item)}>{item.label || t('无标题')}</button></li>)}</ul>
    </details>}
    <details className="note-graph__options">
    <summary>{t('筛选笔记与关系')}{query ? ` · ${query}` : ''}</summary>
    <div className="note-graph__filters">
      <label>{t('查找笔记')}<input type="search" value={query} placeholder={t('输入标题关键词')}
        onChange={event => setFilters({ query: event.target.value })} /></label>
      <label>{t('关系类型')}<select value={relation ?? ''} onChange={event => setFilters({ relation: event.target.value ? event.target.value as LinkRelationType : undefined })}>
        <option value="">{t('全部关系')}</option>{GRAPH_RELATIONS.map(type => <option key={type} value={type}>{t(RELATION_LABELS[type])}</option>)}
      </select></label>
      <label className="note-graph__check"><input type="checkbox" checked={showOrphans} onChange={event => setFilters({ showOrphans: event.target.checked })} />{t('显示未关联笔记')}</label>
    </div>
    </details>
    <div className="note-graph__toolbar">
      <button type="button" className="cozy-btn-secondary" aria-pressed={!local} onClick={() => setFilters({ local: false })}>{t('全局图谱')}</button>
      <button type="button" className="cozy-btn-secondary" disabled={!node && !local} aria-pressed={local} onClick={() => setFilters({ local: true })}>{t('只看这篇周围')}</button>
      {local && <label>{t('关联范围')} <select aria-label={t('关联范围')} value={depth} onChange={event => setFilters({ depth: Number(event.target.value) })}>
        <option value={1}>{t('直接关联')}</option><option value={2}>{t('再延伸一层')}</option>
      </select></label>}
      <button type="button" className="cozy-btn-ghost" onClick={reset}>{t('清除筛选')}</button>
      <button type="button" className="cozy-btn-ghost" disabled={loading} onClick={onRefresh}>{t('刷新')}</button>
    </div>
    <p role="status" className="note-graph__hint">{t('{0} 篇笔记 · {1} 组关联', projected.nodes.length, projected.edges.length)}
      {local && selected && ` · ${t('以「{0}」为中心', titles.get(selected) ?? '')}`}</p>
    {local && query.trim() && <p className="note-graph__hint">{t('局部搜索会保留中心笔记及通往匹配笔记的一条连接路径；中间笔记可能不包含关键词。')}</p>}
    {local && query.trim() && node && projected.nodes.length === 1 && !loading && !error &&
      <p role="status" className="note-graph__hint">{t('当前范围内没有匹配的关联笔记，已保留中心笔记。可清除筛选或扩大关联范围。')}</p>}
    {graph.truncated && <p className="note-graph__hint">{t('大库预览：最多展示最近 1000 篇笔记及 10000 条关系，未显示的内容仍保存在本地。')}</p>}
    {projected.nodes.length ? <GraphCanvas graph={projected} selected={node?.id} onSelect={setSelected} onOpen={onOpen} />
      : <p className="note-graph__empty">{t(loading ? '加载中…' : error ? '图谱暂时加载失败。请点击刷新重试，已有笔记不会因此删除。' : graph.nodes.length ? '当前筛选下没有笔记。试试清除筛选或显示未关联笔记。' : '还没有笔记。先在「快速导入」添加资料。')}</p>}
    <p className="note-graph__hint">{t('滚轮缩放，拖动空白处平移，拖动圆点调整位置。也可用缩放按钮和键盘方向键。')}</p>
    {node ? <aside className="note-graph__selection" aria-label={t('选中笔记的关联')}>
      <div className="note-graph__toolbar"><strong>{node.label}</strong>
        <button type="button" className="cozy-btn-primary" onClick={() => onOpen(node)}>{t('打开笔记')}</button>
        <button type="button" className="cozy-btn-ghost" onClick={() => setSelected(undefined)}>{t('取消选中')}</button>
      </div>
      {connections.length === 0 ? <p>{t('这篇笔记还没有符合当前筛选的关联。可打开笔记，手动连接相关内容。')}</p>
        : <ul>{connections.map(edge => {
          const other = edge.source === node.id ? edge.target : edge.source;
          return <li key={edge.id}>
            <button type="button" className="cozy-link" onClick={() => setSelected(other)}>{titles.get(other)}</button>
            {edge.references?.map(reference => <p key={`${reference.fromId}-${reference.toId}-${reference.kind}`} className="note-graph__reason">
              {titles.get(reference.fromId)} → {titles.get(reference.toId)} · {t(reference.kind === 'link' ? '正文链接' : reference.kind === 'card' ? '知识卡片来源' : '主题目录引用')}
            </p>)}
            {edge.relations.map(link => <div key={link.id} className="note-graph__reason">
              <span>{titles.get(link.fromId)} → {titles.get(link.toId)} · {t(RELATION_LABELS[link.relationType])}</span>
              <small>{t(link.createdBy === 'ai_suggestion' ? 'AI 建议，已确认' : link.createdBy === 'user_manual' ? '手动建立' : '规则关联，已确认')}</small>
              {link.reason && <p>{link.reason}</p>}
            </div>)}
          </li>;
        })}</ul>}
    </aside> : <p className="note-graph__hint">{t('先选中一个圆点，查看它的关联或切换到局部图谱。')}</p>}
  </section>;
}
