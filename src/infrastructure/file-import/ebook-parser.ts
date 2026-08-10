/**
 * 电子书解析（EPUB / MOBI / AZW3）
 *
 * 抽正文的活交给注入的 extractor（Tauri 侧 Rust 库，见 src-tauri/file_parser/ebook.rs）。
 * Rust 侧用 html2text 把每章的 XHTML/HTML 转成了**带 markdown 标题的纯文本**
 * （`<h1>` → `# 标题`，段落用空行分隔），所以这里只需要：章节拼接、清洗、标题推断。
 *
 * 产出 sourceType 为 markdown，切分器复用 Markdown 的标题路径逻辑，
 * 检索时能回溯到具体的章节标题。
 */
import type { ParsedFile } from '@application/ports';
import { inferTitle, normalizeText } from './text-normalizer';

export interface EbookChapter {
  text: string;
}

export interface EbookDocument {
  title?: string;
  author?: string;
  chapters: EbookChapter[];
}

/** 由 infrastructure 注入：Tauri 命令 file_extract_ebook 的封装 */
export type EbookExtractor = (uri: string) => Promise<EbookDocument>;

export class EbookParser {
  constructor(private readonly extractor: EbookExtractor) {}

  async parse(uri: string): Promise<ParsedFile> {
    const document = await this.extractor(uri);

    const parts: string[] = [];
    for (const chapter of document.chapters) {
      const text = normalizeText(chapter.text);
      if (!text) continue;
      parts.push(text);
    }

    const content = parts.join('\n\n');
    if (!content) throw new Error('电子书未提取到正文内容');

    return {
      // 书籍元信息里的标题常是系列名或空，为空时回退到正文首行
      title: document.title?.trim() || inferTitle(content),
      content,
      sourceType: 'markdown',
    };
  }
}
