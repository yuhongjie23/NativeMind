/**
 * Chunk 切分策略（§13.2）
 *
 * 纯函数，无 IO：给文本，出 chunk。实际的解析（PDF → 文本）在 infrastructure/file-import，
 * 落库与 embedding 由 BackgroundJob 负责（§4.3）。
 *
 * 原则：
 * - Markdown 优先按标题层级切，保留 headingPath 便于回溯来源。
 * - PDF / 纯文本按段落聚合到目标长度。
 * - 太短的 chunk 会让关系判断碎片化，太长会让检索不精准，所以两头都设界。
 */

export interface ChunkDraft {
  text: string;
  /** 标题路径，如 ["大模型微调", "QLoRA"]，用于展示与回溯（§13.2） */
  headingPath: string[];
  /** 在原文中的字符起点，回溯原文位置用 */
  offset: number;
}

export interface ChunkOptions {
  targetChars: number;
  /** 小于此长度的 chunk 会被合并进相邻块 */
  minChars: number;
  maxChars: number;
}

export const defaultChunkOptions: ChunkOptions = {
  targetChars: 800,
  minChars: 200,
  maxChars: 1500,
};

interface Section {
  headingPath: string[];
  body: string;
  offset: number;
}

/** 按 ATX 标题切段，同时维护标题栈 */
const splitMarkdownSections = (markdown: string): Section[] => {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  const headingStack: string[] = [];

  let buffer: string[] = [];
  let offset = 0;
  let bufferOffset = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ headingPath: [...headingStack], body, offset: bufferOffset });
    buffer = [];
  };

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingStack.length = Math.min(headingStack.length, level - 1);
      headingStack[level - 1] = heading[2].trim();
      bufferOffset = offset + line.length + 1;
    } else {
      if (buffer.length === 0) bufferOffset = offset;
      buffer.push(line);
    }
    offset += line.length + 1;
  });

  flush();
  return sections;
};

/** 按空行分段，再贪心聚合到 targetChars */
const packParagraphs = (section: Section, options: ChunkOptions): ChunkDraft[] => {
  const paragraphs = section.body.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: ChunkDraft[] = [];

  let current: string[] = [];
  let currentLen = 0;
  let cursor = section.offset;
  let chunkOffset = section.offset;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      text: current.join('\n\n'),
      headingPath: section.headingPath,
      offset: chunkOffset,
    });
    current = [];
    currentLen = 0;
  };

  paragraphs.forEach((paragraph) => {
    // 单段就超上限：硬切，避免出现巨型 chunk 拖慢检索
    if (paragraph.length > options.maxChars) {
      flush();
      for (let i = 0; i < paragraph.length; i += options.targetChars) {
        chunks.push({
          text: paragraph.slice(i, i + options.targetChars),
          headingPath: section.headingPath,
          offset: cursor + i,
        });
      }
      cursor += paragraph.length + 2;
      chunkOffset = cursor;
      return;
    }

    if (current.length === 0) chunkOffset = cursor;
    current.push(paragraph);
    currentLen += paragraph.length;
    cursor += paragraph.length + 2;

    if (currentLen >= options.targetChars) flush();
  });

  flush();
  return chunks;
};

/** 把过短的 chunk 并进前一个，减少碎片 */
const mergeShortChunks = (chunks: ChunkDraft[], minChars: number, maxChars: number): ChunkDraft[] =>
  chunks.reduce<ChunkDraft[]>((acc, chunk) => {
    const prev = acc[acc.length - 1];
    // 判断当前块是否过短（而不是上一块）：独立短块后接正常块时也会被吸收，
    // 不再留下「短块碎片」。用 maxChars 兜底，避免一个块无限吞并短块。
    const sameSection =
      prev &&
      prev.headingPath.join('/') === chunk.headingPath.join('/') &&
      chunk.text.length < minChars &&
      prev.text.length < maxChars;

    if (sameSection) prev.text = `${prev.text}\n\n${chunk.text}`;
    else acc.push({ ...chunk });

    return acc;
  }, []);

export function chunkMarkdown(markdown: string, options = defaultChunkOptions): ChunkDraft[] {
  const chunks = splitMarkdownSections(markdown).flatMap((section) =>
    packParagraphs(section, options)
  );
  return mergeShortChunks(chunks, options.minChars, options.maxChars).filter((c) => c.text.trim());
}

/** PDF / 纯文本：没有标题结构，直接按段落聚合 */
export function chunkPlainText(text: string, options = defaultChunkOptions): ChunkDraft[] {
  const chunks = packParagraphs({ headingPath: [], body: text, offset: 0 }, options);
  return mergeShortChunks(chunks, options.minChars, options.maxChars).filter((c) => c.text.trim());
}

export function chunkText(
  text: string,
  sourceType: 'markdown' | 'pdf' | 'text',
  options = defaultChunkOptions
): ChunkDraft[] {
  return sourceType === 'markdown' ? chunkMarkdown(text, options) : chunkPlainText(text, options);
}
