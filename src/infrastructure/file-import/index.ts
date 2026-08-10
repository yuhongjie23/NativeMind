/**
 * FileImportPort 的实现：按扩展名分派到对应解析器
 *
 * 用例层只调 parse(source) / hash(content)，不关心是 PDF 还是 Markdown。
 *
 * source 显式分 path 和 text 两种：直接给文本的分支根本不碰文件系统，
 * 所以粘贴的正文不可能被当成路径去解析（那会在 Windows 上报 os error 123）。
 */

import type { FileImportPort, ImportSource, ParsedFile } from '@application/ports';

import { EbookParser, type EbookExtractor } from './ebook-parser';
import { parseMarkdown } from './markdown-parser';
import { PdfParser, type PdfExtractor } from './pdf-parser';
import { hashContent, inferTitle, normalizeText } from './text-normalizer';

export * from './ebook-parser';
export * from './markdown-parser';
export * from './pdf-parser';
export * from './text-normalizer';

/** 读文件的活由宿主提供（Tauri 的 fs 或测试里的假实现） */
export type TextFileReader = (uri: string) => Promise<string>;

export interface FileImportOptions {
  readTextFile: TextFileReader;
  /** 没提供就不支持 PDF，遇到 .pdf 会给出明确报错而不是静默返回空内容 */
  pdfExtractor?: PdfExtractor;
  /** 没提供就不支持电子书，遇到 .epub/.mobi/.azw3 会给出明确报错 */
  ebookExtractor?: EbookExtractor;
}

const extensionOf = (uri: string): string => {
  const clean = uri.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
};

export class FileImportService implements FileImportPort {
  private readonly pdfParser?: PdfParser;
  private readonly ebookParser?: EbookParser;

  constructor(private readonly options: FileImportOptions) {
    this.pdfParser = options.pdfExtractor ? new PdfParser(options.pdfExtractor) : undefined;
    this.ebookParser = options.ebookExtractor ? new EbookParser(options.ebookExtractor) : undefined;
  }

  async parse(source: ImportSource): Promise<ParsedFile> {
    // 直接给文本：不碰文件系统，也不看扩展名
    if (source.kind === 'text') {
      const content = normalizeText(source.content);
      if (!content) throw new Error('导入内容为空');
      return {
        title: source.title?.trim() || inferTitle(content),
        content,
        sourceType: 'text',
      };
    }

    const extension = extensionOf(source.path);

    if (extension === 'pdf') {
      if (!this.pdfParser) throw new Error('未配置 PDF 解析器，无法导入 PDF');
      const parsed = await this.pdfParser.parse(source.path);
      return {
        title: parsed.title,
        content: parsed.content,
        sourceType: 'pdf',
        // 页范围随笔记存下来，查看长文时能定位页码
        pageRanges: parsed.pageRanges,
      };
    }

    if (['epub', 'mobi', 'azw3', 'azw', 'prc'].includes(extension)) {
      if (!this.ebookParser) throw new Error('未配置电子书解析器，无法导入电子书');
      return this.ebookParser.parse(source.path);
    }

    const raw = await this.options.readTextFile(source.path);

    if (extension === 'md' || extension === 'markdown') {
      const parsed = parseMarkdown(raw);
      return { title: parsed.title, content: parsed.content, sourceType: 'markdown' };
    }

    const content = normalizeText(raw);
    return { title: inferTitle(content), content, sourceType: 'text' };
  }


  hash(content: string): Promise<string> {
    return hashContent(content);
  }
}
