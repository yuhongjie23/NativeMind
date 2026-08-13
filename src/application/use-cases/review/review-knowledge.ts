/**
 * 复盘知识关联摘要（⑤：复盘生成时把已确认的知识链接作为证据）
 *
 * 用户显式确认过的知识链接是长期资产——复盘时让模型知道这些关系，
 * 它才能在正文里自然地关联旧知识（如「QLoRA 是 LoRA 的延伸」）。
 *
 * 摘要必须是确定性的（程序拼接，不经过模型），只取已确认、未归档的链接，
 * 限制条数避免刷屏。纯函数便于单测。
 */
import type {
  KnowledgeLink,
  KnowledgeLinkRepository,
  LinkRelationType,
  NoteRepository,
} from '../../ports';

/** 关系类型中文名（与 knowledge-link-store 的 RELATION_LABELS 同义，避免跨层依赖） */
const RELATION_CN: Record<LinkRelationType, string> = {
  same_concept: '同一概念',
  prerequisite: '前置知识',
  example_of: '例子',
  contrast: '对比',
  extends: '延伸',
  review_later: '需要复习',
};

export interface KnowledgeLinkDisplay {
  fromTitle: string;
  toTitle: string;
  relationType: LinkRelationType;
}

/**
 * 把已确认的链接转成可读摘要文本。
 * @param links 已过滤（confirmedByUser && !archivedAt）的链接
 * @param titleById note id → 标题 的查找表（拿不到标题的端点跳过）
 * @param maxLinks 最多展示多少条
 */
export const knowledgeLinksSummary = (
  links: KnowledgeLink[],
  titleById: Map<string, string>,
  maxLinks = 8
): string => {
  if (links.length === 0) return '（无已确认的知识关联）';

  const lines: string[] = [];
  for (const link of links) {
    const from = titleById.get(link.fromId);
    const to = titleById.get(link.toId);
    if (!from || !to) continue;
    const rel = RELATION_CN[link.relationType] ?? link.relationType;
    lines.push(`- 《${from}》 —${rel}→ 《${to}》`);
    if (lines.length >= maxLinks) break;
  }
  return lines.length > 0 ? lines.join('\n') : '（无已确认的知识关联）';
};

/** 从全量链接里挑出「笔记端点」并去重成标题查找表（简化：链接本身带 from/to 标题名则直接用） */
export const buildTitleLookup = (notes: { id: string; title: string }[]): Map<string, string> =>
  new Map(notes.map((note) => [note.id, note.title]));

/**
 * 复盘知识关联摘要（⑤）：查已确认链接 → 组装可读文本。
 * 供日/周/月三个复盘用例共用；失败或空链接返回 undefined（调用方照常生成）。
 */
export async function fetchKnowledgeSummary(
  linkRepo?: KnowledgeLinkRepository,
  noteRepo?: NoteRepository
): Promise<string | undefined> {
  if (!linkRepo || !noteRepo) return undefined;
  try {
    const links = await linkRepo.query({ onlyConfirmed: true });
    if (links.length === 0) return undefined;
    // 链接通常不多，逐个取对端标题；拿不到标题的端点跳过
    const titleById = new Map<string, string>();
    for (const link of links) {
      for (const id of [link.fromId, link.toId]) {
        if (titleById.has(id)) continue;
        const note = await noteRepo.findById(id);
        if (note) titleById.set(id, note.title);
      }
    }
    const summary = knowledgeLinksSummary(links, titleById);
    return summary.startsWith('（无') ? undefined : summary;
  } catch {
    // 链接读取失败：复盘照常生成，只是缺知识关联段
    return undefined;
  }
}
