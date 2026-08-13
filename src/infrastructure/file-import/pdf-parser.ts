/**
 * PDF 解析
 *
 * 抽文字的活交给注入的 extractor（Tauri 侧的 Rust 库或 pdf.js），
 * 本模块只负责「拿到分页文本之后」的清洗、页码归属和标题推断。
 * 这样换解析引擎不影响索引流水线，也让这段逻辑能脱离 PDF 运行时测试。
 */
import { inferTitle, normalizeText, repairLineBreaks } from './text-normalizer';

export interface PdfPage {
  page: number;
  text: string;
}

export interface PdfDocument {
  pages: PdfPage[];
  metadata?: { title?: string; author?: string };
}

/** 由 infrastructure 注入：Tauri 命令或 pdf.js 包装 */
export type PdfExtractor = (uri: string) => Promise<PdfDocument>;

export interface ParsedPdf {
  title: string;
  content: string;
  /** 每页在拼接后正文中的字符区间，切分时用来给 chunk 标页码 */
  pageRanges: { page: number; start: number; end: number }[];
  metadata: Record<string, string>;
}

/**
 * 页眉页脚检测：同一行文本在多页重复出现，基本就是页眉/页脚。
 * 不去掉它们会在每个 chunk 里塞进重复噪声，稀释检索相关性。
 */
const findRepeatedLines = (pages: PdfPage[]): Set<string> => {
  if (pages.length < 3) return new Set();

  const counts = new Map<string, number>();
  pages.forEach((page) => {
    const lines = page.text.split('\n').map((line) => line.trim());
    // 只看首尾两行，正文里的重复句子不该被误删
    [...lines.slice(0, 2), ...lines.slice(-2)]
      .filter((line) => line.length > 0 && line.length < 80)
      .forEach((line) => counts.set(line, (counts.get(line) ?? 0) + 1));
  });

  const threshold = Math.max(3, Math.floor(pages.length * 0.6));
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line)
  );
};

/** 纯页码行（"12"、"- 12 -"）也一并去掉 */
const isPageNumber = (line: string): boolean => /^[-–—\s]*\d{1,4}[-–—\s]*$/.test(line);

const cleanPage = (text: string, repeated: Set<string>): string =>
  repairLineBreaks(
    text
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !repeated.has(trimmed) && !isPageNumber(trimmed);
      })
      .join('\n')
  );

export class PdfParser {
  constructor(private readonly extractor: PdfExtractor) {}

  async parse(uri: string): Promise<ParsedPdf> {
    const document = await this.extractor(uri);
    const repeated = findRepeatedLines(document.pages);

    const pageRanges: ParsedPdf['pageRanges'] = [];
    const parts: string[] = [];
    let cursor = 0;

    document.pages.forEach((page) => {
      const cleaned = normalizeText(cleanPage(page.text, repeated));
      if (!cleaned) return;

      pageRanges.push({ page: page.page, start: cursor, end: cursor + cleaned.length });
      parts.push(cleaned);
      // +2 是页之间的空行分隔
      cursor += cleaned.length + 2;
    });

    const content = parts.join('\n\n');
    const metadata: Record<string, string> = {};
    if (document.metadata?.author) metadata.author = document.metadata.author;
    if (document.metadata?.title) metadata.title = document.metadata.title;

    return {
      // PDF 元信息里的标题常是文件名或空，所以为空时回退到正文首行
      title: document.metadata?.title?.trim() || inferTitle(content),
      content,
      pageRanges,
      metadata,
    };
  }
}

/** 给定字符位置查它在第几页，写进 chunk 的 page 字段 */
export const pageAt = (ranges: ParsedPdf['pageRanges'], position: number): number | undefined =>
  ranges.find((range) => position >= range.start && position <= range.end)?.page;
