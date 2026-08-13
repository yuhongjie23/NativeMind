/**
 * 解析与归一化的单测
 * 这几个是纯函数，索引质量直接取决于它们，所以重点覆盖噪声输入。
 */
import { describe, expect, it } from 'vitest';
import { FileImportService } from '@infrastructure/file-import';
import { headingPathAt, parseMarkdown } from '@infrastructure/file-import/markdown-parser';
import { PdfParser, pageAt } from '@infrastructure/file-import/pdf-parser';
import { hashContent, normalizeText, repairLineBreaks } from '@infrastructure/file-import/text-normalizer';

describe('normalizeText', () => {
  it('统一换行并去掉不可见字符', () => {
    const result = normalizeText('a\r\nb\u200Bc\uFEFF');
    expect(result).toBe('a\nbc');
  });

  it('压缩多余空行但保留段落分隔', () => {
    expect(normalizeText('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('repairLineBreaks', () => {
  it('接回连字符断词', () => {
    expect(repairLineBreaks('exam-\nple')).toBe('example');
  });

  it('中文软换行不补空格', () => {
    expect(repairLineBreaks('学习\n节律')).toBe('学习节律');
  });
});

describe('hashContent', () => {
  it('同内容同哈希，异内容异哈希', async () => {
    const a = await hashContent('hello');
    const b = await hashContent('hello');
    const c = await hashContent('hello!');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('parseMarkdown', () => {
  const raw = `---
title: 深度工作
tags: [专注, 方法论]
---
# 深度工作

## 第一原则

正文内容

\`\`\`js
// # 这不是标题
\`\`\`
`;

  it('读取 frontmatter 的标题与标签', () => {
    const parsed = parseMarkdown(raw);
    expect(parsed.title).toBe('深度工作');
    expect(parsed.tags).toEqual(['专注', '方法论']);
  });

  it('忽略代码块里的井号', () => {
    const parsed = parseMarkdown(raw);
    expect(parsed.headings.map((heading) => heading.text)).toEqual(['深度工作', '第一原则']);
  });

  it('按位置回溯标题路径', () => {
    const parsed = parseMarkdown(raw);
    const position = parsed.content.indexOf('正文内容');
    expect(headingPathAt(parsed.headings, position)).toEqual(['深度工作', '第一原则']);
  });
});

describe('PdfParser', () => {
  const pages = Array.from({ length: 4 }, (_, index) => ({
    page: index + 1,
    text: `NativeMind 手册\n第 ${index + 1} 页正文\n${index + 1}`,
  }));

  it('去掉重复页眉和纯页码行', async () => {
    const parser = new PdfParser(async () => ({ pages }));
    const parsed = await parser.parse('doc.pdf');

    expect(parsed.content).not.toContain('NativeMind 手册');
    expect(parsed.content).toContain('第 1 页正文');
  });

  it('给字符位置定位页码', async () => {
    const parser = new PdfParser(async () => ({ pages }));
    const parsed = await parser.parse('doc.pdf');
    const position = parsed.content.indexOf('第 3 页正文');

    expect(pageAt(parsed.pageRanges, position)).toBe(3);
  });
});

describe('FileImportService', () => {
  const service = new FileImportService({
    readTextFile: async (uri) => (uri.endsWith('.md') ? '# 标题\n\n内容' : '纯文本首行\n第二行'),
  });

  it('按扩展名分派 sourceType', async () => {
    await expect(service.parse({ kind: 'path', path: 'a.md' })).resolves.toMatchObject({
      title: '标题',
      sourceType: 'markdown',
    });
    await expect(service.parse({ kind: 'path', path: 'a.txt' })).resolves.toMatchObject({
      title: '纯文本首行',
      sourceType: 'text',
    });
  });

  it('未配置解析器时明确拒绝 PDF', async () => {
    await expect(service.parse({ kind: 'path', path: 'a.pdf' })).rejects.toThrow(
      '未配置 PDF 解析器'
    );
  });
  it('配置了解析器后按页导入 PDF', async () => {
    const withPdf = new FileImportService({
      readTextFile: async () => '',
      pdfExtractor: async () => ({
        pages: [{ page: 1, text: 'PDF 正文第一行' }],
        metadata: { title: '我的 PDF', author: '某作者' },
      }),
    });

    const parsed = await withPdf.parse({ kind: 'path', path: 'doc.pdf' });
    expect(parsed).toMatchObject({ title: '我的 PDF', sourceType: 'pdf' });
    expect(parsed.content).toContain('PDF 正文第一行');
  });



  /**
   * text 来源必须完全绕开文件系统。
   *
   * 这是 os error 123 的回归测试：以前粘贴的正文会被当成路径去读，
   * 桌面端 canonicalize 直接失败。readTextFile 在这里会抛错，
   * 用例能过就证明这条分支没碰它。
   */
  describe('text 来源', () => {
    const failing = new FileImportService({
      readTextFile: async () => {
        throw new Error('不该读文件');
      },
    });

    it('直接用正文，不碰文件系统', async () => {
      await expect(failing.parse({ kind: 'text', content: '粘贴的第一行\n第二行' })).resolves.toMatchObject(
        { title: '粘贴的第一行', sourceType: 'text' }
      );
    });

    it('给了标题就用给的', async () => {
      const parsed = await failing.parse({
        kind: 'text',
        content: '正文首行',
        title: '我自己起的标题',
      });
      expect(parsed.title).toBe('我自己起的标题');
    });

    it('内容为空时明确报错，而不是存一条空笔记', async () => {
      await expect(failing.parse({ kind: 'text', content: '   \n  ' })).rejects.toThrow('内容为空');
    });

    it('看起来像路径的正文也按文本处理', async () => {
      // 用户可能真的想把一行路径记成笔记，这时不该去读那个文件
      const parsed = await failing.parse({ kind: 'text', content: 'C:\\notes\\a.md' });
      expect(parsed.content).toBe('C:\\notes\\a.md');
      expect(parsed.sourceType).toBe('text');
    });
  });
});


