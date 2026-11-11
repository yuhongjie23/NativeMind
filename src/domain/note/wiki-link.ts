export interface WikiLink { title: string; label: string; start: number; end: number }

/** Literal, case-sensitive note titles. Code, escapes and unsupported section links stay text. */
export function parseWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  let fence: { char: string; length: number } | undefined;
  let offset = 0;
  let inlineEnd = 0;
  for (const line of content.split('\n')) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (boundary && boundary[1][0] === fence.char && boundary[1].length >= fence.length && !boundary[2].trim()) fence = undefined;
    } else if (boundary && inlineEnd <= offset) {
      fence = { char: boundary[1][0], length: boundary[1].length };
    } else {
      for (let i = Math.max(0, inlineEnd - offset); i < line.length;) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === '`') {
          const run = /^`+/.exec(line.slice(i))![0];
          let end = content.indexOf(run, offset + i + run.length);
          while (end >= 0 && (content[end - 1] === '`' || content[end + run.length] === '`')) end = content.indexOf(run, end + run.length);
          if (end >= 0) inlineEnd = end + run.length;
          i = end < 0 ? i + run.length : inlineEnd - offset;
          continue;
        }
        if (line.startsWith('[[', i) && line[i - 1] !== '[' && line[i - 1] !== '!') {
          const match = /^\[\[([^\]\r\n[]{1,500})\]\](?!\])/.exec(line.slice(i, i + 505));
          if (match) {
            const parts = match[1].split('|');
            const title = parts[0].trim();
            const label = parts[1]?.trim() ?? title;
            if (parts.length <= 2 && title && label && !/[#^]/.test(title)) {
              links.push({ title, label, start: offset + i, end: offset + i + match[0].length });
            }
            i += match[0].length;
            continue;
          }
        }
        i++;
      }
    }
    offset += line.length + 1;
  }
  return links;
}
