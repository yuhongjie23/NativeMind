/** Read-only prompt compression: select one contiguous source window, never synthesize evidence. */
const STOP_WORDS = new Set('the and for with from this that what which when where why how does do are was were can could should would about into than then have has explain according 为什 什么 如何 怎样 是否 哪些 一个 这个 那个 可以 以及 为什么'.split(' '));

function queryTerms(query: string): string[] {
  const lower = query.toLowerCase();
  const latin = lower.match(/[a-z][a-z0-9+#._-]{1,}/g) ?? [];
  const chinese = (lower.match(/[\u3400-\u9fff]{2,}/g) ?? []).flatMap(run =>
    Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2)));
  return [...new Set([...latin, ...chinese])].filter(term => !STOP_WORDS.has(term)).slice(0, 32);
}

export function selectRerankExcerpt(text: string, query: string, maxChars: number): string {
  return selectSourceExcerpt(text, query, maxChars).text;
}

/** Offset is retained explicitly: looking up a repeated excerpt with indexOf would lose its origin. */
export function selectSourceExcerpt(text: string, query: string, maxChars: number): { text: string; offset: number } {
  const budget = Math.max(0, Math.floor(maxChars));
  if (!budget) return { text: '', offset: 0 };
  if (text.length <= budget) return { text, offset: 0 };
  const terms = queryTerms(query);
  if (!terms.length) return { text: text.slice(0, budget), offset: 0 };
  const lastStart = text.length - budget;
  const stride = Math.max(1, Math.floor(budget / 4));
  let bestStart = 0;
  let bestScore = 0;
  // Overlapping windows keep nearby qualifiers/negations, without combining unrelated passages.
  for (let start = 0; ; start = Math.min(start + stride, lastStart)) {
    const window = text.slice(start, start + budget).toLowerCase();
    let score = 0;
    for (const term of terms) {
      const at = window.indexOf(term);
      if (at < 0) continue;
      // Distinct terms dominate; on ties prefer matches away from a cut boundary.
      score += 1 + Math.max(0, Math.min(at, window.length - at - term.length)) / (budget * 10);
    }
    if (score > bestScore) { bestScore = score; bestStart = start; }
    if (start === lastStart) break;
  }
  return { text: text.slice(bestStart, bestStart + budget), offset: bestStart };
}
