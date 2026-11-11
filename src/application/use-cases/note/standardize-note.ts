import type { GenerationOptions, NoteRepository, NoteStandardizationPort, StandardNoteDraft } from '../../ports';
import type { ConfirmationService } from '../../confirmation/confirmation-service';
import type { ImportNoteUseCase } from './import-note';
import { needsReadableTitle } from '@domain/note/title-quality';

export const MAX_STANDARD_NOTE_CHARS = 12000;
export interface StandardNoteProposal { sourceTitle: string; original: string; title: string; content: string }
const headings = {
  overview: ['概述', 'Overview'], concepts: ['核心概念', 'Key concepts'], conditions: ['适用条件与限制', 'Conditions and limitations'],
  steps: ['过程与步骤', 'Process and steps'], examples: ['例子与应用', 'Examples and applications'], questions: ['待澄清问题', 'Open questions'],
} as const;

export function renderStandardNote(draft: StandardNoteDraft, source: string, language: 'zh' | 'en'): string {
  if (draft.status !== 'ready' || typeof draft.title !== 'string' || draft.title.trim().length > 100
    || draft.title.trim().length < 2 || needsReadableTitle(draft.title) || /[\r\n[\]]/.test(draft.title)
    || !Array.isArray(draft.blocks) || draft.blocks.length < 1 || draft.blocks.length > 24
    || draft.blocks.filter(block => block.kind === 'overview').length !== 1) throw new Error('标准笔记格式无效，请重新整理。');
  for (const block of draft.blocks) {
    if (!Object.prototype.hasOwnProperty.call(headings, block.kind) || typeof block.text !== 'string' || !block.text.trim() || block.text.length > 1800
      || typeof block.quote !== 'string' || block.quote.trim().length < 12 || block.quote.length > 1200) throw new Error('标准笔记格式无效，请重新整理。');
    const start = source.indexOf(block.quote);
    if (start < 0 || source.indexOf(block.quote, start + 1) >= 0) throw new Error('标准笔记的原文依据无法唯一定位，请重新整理。');
    // AI must not create hidden graph links as a side effect of rewriting text.
    if (block.text.includes('[[')) throw new Error('标准笔记中包含未经确认的链接，请重新整理。');
  }
  const en = language === 'en';
  const sections = (Object.keys(headings) as Array<keyof typeof headings>).flatMap(kind => {
    const blocks = draft.blocks.filter(block => block.kind === kind);
    return blocks.length ? [`## ${headings[kind][en ? 1 : 0]}\n\n${blocks.map(block => block.text.trim()).join('\n\n')}`] : [];
  });
  const quotes = [...new Set(draft.blocks.map(block => block.quote))];
  const body = sections.join('\n\n');
  if (body.length > 20000) throw new Error('标准笔记过长，请重新整理。');
  return `${body}\n\n## ${en ? 'Source evidence' : '原文依据'}\n\n${quotes.map(quote => `> ${quote.replace(/\n/g, '\n> ')}`).join('\n\n')}`;
}

export class StandardizeNoteUseCase {
  private readonly running = new Set<string>();
  constructor(private readonly notes: NoteRepository, private readonly ai: NoteStandardizationPort | undefined,
    private readonly confirmation: ConfirmationService, private readonly importer: ImportNoteUseCase) {}

  async execute(id: string, language: 'zh' | 'en', options?: GenerationOptions & { onCommit?: () => void }) {
    if (!this.ai) throw new Error('浏览器演示模式不支持 DeepSeek 知识整理，请使用桌面版。');
    if (this.running.has(id)) throw new Error('这篇笔记正在整理，请完成或取消后再试。');
    this.running.add(id);
    try {
      options?.signal?.throwIfAborted();
      await this.ai.requireAccess();
      const source = await this.notes.findById(id);
      if (!source) throw new Error('原笔记已不存在，无法整理。');
      if (source.content.length > MAX_STANDARD_NOTE_CHARS) throw new Error('全文超过 12000 字符，请先拆成独立笔记后整理；本功能不会截断全文。');
      if (source.content.trim().length < 12) return undefined;
      const draft = await this.ai.draft(source.content, language, options);
      options?.signal?.throwIfAborted();
      await this.ai.requireAccess();
      if (draft.status === 'insufficient') return undefined;
      const content = renderStandardNote(draft, source.content, language);
      const title = `${draft.title.trim()}${language === 'en' ? ' (organized)' : '（整理版）'}`;
      const assertCurrent = async () => {
        const current = await this.notes.findById(id);
        if (!current || current.title !== source.title || current.content !== source.content || current.contentHash !== source.contentHash)
          throw new Error('原笔记已修改或删除，请重新整理后保存。');
      };
      await assertCurrent();
      const sourceLabel = language === 'en' ? 'Source note' : '来源笔记';
      const unique = (await this.notes.findByTitle(source.title)).length === 1 && !/[[\]|\r\n]/.test(source.title);
      const sourceLine = `${sourceLabel}: ${unique ? `[[${source.title}]]` : source.title}`;
      const prepared = `${sourceLine}\n\n${content}`;
      const payload: StandardNoteProposal = { sourceTitle: source.title, original: source.content, title, content: prepared };
      const result = await this.confirmation.confirmAndCommit({ actionType: 'standardize_note',
        summary: language === 'en' ? 'Review the organized note' : '检查标准笔记草稿', payload }, async () => {
        await this.ai!.requireAccess();
        options?.signal?.throwIfAborted();
        await assertCurrent();
        // Save the reviewed snapshot as a copy via the existing atomic note + index-job import.
        return this.importer.execute({ kind: 'text', title, content: prepared, tags: source.tags }, { signal: options?.signal });
      }, options);
      return result.result;
    } finally { this.running.delete(id); }
  }
}
