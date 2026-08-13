/**
 * 电子书解析与分派的单测
 * Rust 侧负责解包，这里只测 TS 的组装与分派逻辑。
 */
import { describe, expect, it } from 'vitest';
import { EbookParser } from '@infrastructure/file-import/ebook-parser';
import { FileImportService } from '@infrastructure/file-import';

describe('EbookParser', () => {
  it('保留各章节的 markdown 标题，章节间用空行分隔', async () => {
    const parser = new EbookParser(async () => ({
      title: '深度学习',
      author: '某人',
      chapters: [
        { text: '# 第一章\n\n第一章的正文。' },
        { text: '# 第二章\n\n第二章的正文。' },
      ],
    }));

    const parsed = await parser.parse('book.epub');
    expect(parsed.title).toBe('深度学习');
    expect(parsed.sourceType).toBe('markdown');
    expect(parsed.content).toContain('# 第一章');
    expect(parsed.content).toContain('# 第二章');
    // 章节之间用空行分隔
    expect(parsed.content).toMatch(/第一章的正文。\n\n# 第二章/);
  });

  it('元信息没有标题时回退到正文首行', async () => {
    const parser = new EbookParser(async () => ({
      chapters: [{ text: '正文第一行。\n\n后续内容。' }],
    }));

    const parsed = await parser.parse('book.azw3');
    expect(parsed.title).toBe('正文第一行。');
  });

  it('空章节跳过、全部为空时报错而不是存空笔记', async () => {
    const parser = new EbookParser(async () => ({
      chapters: [{ text: '   ' }, { text: '\n\n' }],
    }));

    await expect(parser.parse('book.epub')).rejects.toThrow('未提取到正文');
  });
});

describe('FileImportService 电子书分派', () => {
  const ebookService = new FileImportService({
    readTextFile: async () => {
      throw new Error('不该把电子书当文本读');
    },
    ebookExtractor: async () => ({
      title: '电子书',
      chapters: [{ text: '# 第一章\n\n电子书正文。' }],
    }),
  });

  it.each(['a.epub', 'a.mobi', 'a.azw3', 'a.azw'])('按扩展名 %s 走电子书解析', async (path) => {
    const parsed = await ebookService.parse({ kind: 'path', path });
    expect(parsed).toMatchObject({ title: '电子书', sourceType: 'markdown' });
    expect(parsed.content).toContain('电子书正文。');
  });

  it('未配置解析器时明确拒绝电子书，而不是把二进制当文本读', async () => {
    const bare = new FileImportService({
      readTextFile: async () => {
        throw new Error('不该读到这一步');
      },
    });

    await expect(bare.parse({ kind: 'path', path: 'a.epub' })).rejects.toThrow(
      '未配置电子书解析器'
    );
  });
});
