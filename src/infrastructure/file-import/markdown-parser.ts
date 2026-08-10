/**
 * Markdown 解析
 *
 * 不做完整 AST，只抽三样索引真正需要的东西：
 * 标题、frontmatter 元信息、标题层级路径（切分时用来给 chunk 定位）。
 */
import { inferTitle, normalizeText } from './text-normalizer';

export interface MarkdownHeading {
  level: number;
  text: string;
  /** 该标题在正文中的字符偏移，切分时按它划边界 */
  offset: number;
  /** 从最外层到当前标题的路径，例如 ["第一章", "1.1 概念"] */
  path: string[];
}

export interface ParsedMarkdown {
  title: string;
  content: string;
  headings: MarkdownHeading[];
  frontmatter: Record<string, string>;
  tags: string[];
}

/** 只解析 `key: value` 的平铺 frontmatter，嵌套结构用不上也不猜 */
const parseFrontmatter = (input: string): { body: string; data: Record<string, string> } => {
  const match = input.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: input, data: {} };

  const data: Record<string, string> = {};
  match[1].split('\n').forEach((line) => {
    const separator = line.indexOf(':');
    if (separator <= 0) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key) data[key] = value;
  });

  return { body: input.slice(match[0].length), data };
};

/** 代码块里的 # 不是标题，先记下围栏区间再跳过 */
const isInsideCodeFence = (lines: string[], index: number): boolean => {
  let fenced = false;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (/^\s*```/.test(lines[cursor])) fenced = !fenced;
  }
  return fenced;
};

const collectHeadings = (content: string): MarkdownHeading[] => {
  const lines = content.split('\n');
  const headings: MarkdownHeading[] = [];
  /** 各层级当前的标题文本，用来拼 path */
  const stack: string[] = [];
  let offset = 0;

  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match && !isInsideCodeFence(lines, index)) {
      const level = match[1].length;
      const text = match[2].trim();
      stack.length = level - 1;
      stack[level - 1] = text;
      headings.push({ level, text, offset, path: stack.filter(Boolean).slice() });
    }
    offset += line.length + 1;
  });

  return headings;
};

/** frontmatter 的 tags 支持 `a, b` 和 `[a, b]` 两种写法 */
const parseTags = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
};

export const parseMarkdown = (raw: string): ParsedMarkdown => {
  const { body, data } = parseFrontmatter(raw);
  const content = normalizeText(body);
  const headings = collectHeadings(content);

  return {
    // frontmatter 的 title 优先，其次一级标题，最后猜第一行
    title: data.title ?? headings.find((heading) => heading.level === 1)?.text ?? inferTitle(content),
    content,
    headings,
    frontmatter: data,
    tags: parseTags(data.tags),
  };
};

/** 给定字符位置，返回它所属的标题路径。chunk 落库时写进 heading_path */
export const headingPathAt = (headings: MarkdownHeading[], position: number): string[] => {
  let current: string[] = [];
  for (const heading of headings) {
    if (heading.offset > position) break;
    current = heading.path;
  }
  return current;
};
