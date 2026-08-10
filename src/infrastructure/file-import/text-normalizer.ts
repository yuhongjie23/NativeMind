/**
 * 文本归一化
 *
 * 解析出来的原文常带一堆噪声：BOM、CRLF、零宽字符、PDF 的连字符断行。
 * 这些噪声会污染切分边界和内容哈希（同一份文件反复被判定为「变了」），
 * 所以在入库前统一洗一遍。
 */

/** 零宽字符与 BOM，肉眼看不见但会让哈希不稳 */
const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;

export const normalizeText = (input: string): string =>
  input
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    // 制表符转两个空格，保住 Markdown 缩进语义
    .replace(/\t/g, '  ')
    // 行尾空白
    .replace(/[ \t]+$/gm, '')
    // 三个以上连续空行压成两个，段落结构还在但不留大片空白
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * 修复 PDF 抽取常见的断行：
 * - 「exam-\nple」→「example」
 * - 句子中间的软换行接回去，段落之间的空行保留
 * 中日韩文本不加空格，西文之间补一个空格。
 */
export const repairLineBreaks = (input: string): string =>
  input
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
    .replace(/([\u4e00-\u9fff])\n([\u4e00-\u9fff])/g, '$1$2')
    .replace(/([a-z,;:])\n([a-z])/g, '$1 $2');

/** 内容哈希，用于导入去重与「内容是否变化」判断 */
export const hashContent = async (content: string): Promise<string> => {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(content);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `sha256:${hex}`;
  }

  // 没有 WebCrypto 的环境（老 WebView）退到简易哈希，只用于本地去重，不做安全用途
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = Math.imul(31, hash) + content.charCodeAt(index);
  }
  return `fallback:${(hash >>> 0).toString(16)}`;
};

/** 从正文猜标题：第一个非空行，去掉 Markdown 的 # 前缀 */
export const inferTitle = (content: string, fallback = '未命名笔记'): string => {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return fallback;
  return firstLine.replace(/^#+\s*/, '').trim().slice(0, 120) || fallback;
};
