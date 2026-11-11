/** Runtime word segmentation avoids embedding Chinese sliding-window gibberish. */
const stopWords = new Set([
  '为什么', '怎么', '如何', '什么', '哪些', '哪个', '是否', '请问',
  'the', 'and', 'for', 'with', 'what', 'which', 'does', 'why', 'how', 'are',
]);
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh', { granularity: 'word' }) : undefined;

export function extractKeywords(text: string, limit = 12): string[] {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  const runs = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const chinese = runs.flatMap(run => {
    // Preserve short technical names such as 提取率 and 知识图谱 intact.
    if (run.length <= 4) return [run];
    const words = segmenter
      ? [...segmenter.segment(run)].filter(part => part.isWordLike && part.segment.length >= 2).map(part => part.segment)
      : [];
    return words.length ? words : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2));
  });
  return [...new Set([...latin, ...chinese])].filter(word => !stopWords.has(word)).slice(0, Math.max(0, limit));
}
