// Synthetic, fixed evidence labels; no user documents. Keep passage length below normal 1500-char chunks.
export function longPassageCases() {
  const zh = '本节说明记录的版式、页码和目录编排。图表编号沿用前文规则，阅读时可以按照章节顺序查阅。';
  const en = 'This section describes the page layout, numbering and table of contents. The following entries use the same editorial conventions. ';
  const topics = [
    { name: 'tea', query: '茶多酚提取率为什么不会随温度无限升高？',
      evidence: '茶多酚提取率并非随温度无限升高而增加。过高温度会使茶多酚氧化降解，因此应避免过热。',
      distractor: '茶多酚提取率的数值列在数据表中，本段只说明百分比的排版格式，未讨论温度效应。', filler: zh },
    { name: 'binary', query: '二分查找为什么必须每次缩小区间，否则会怎样？',
      evidence: '二分查找的边界更新必须使区间严格缩小，否则相同区间会被反复处理而形成死循环。',
      distractor: '二分查找章节的练习题编号列在目录中，这里没有说明区间更新和终止的规则。', filler: zh },
    { name: 'english', query: 'Why should active recall be followed by feedback?',
      evidence: 'Active recall should be followed by feedback because checking an attempted answer reveals errors and allows incorrect memories to be corrected.',
      distractor: 'Active recall and feedback appear as chapter titles in the contents list. This paragraph only describes page numbering, not their learning mechanisms.', filler: en },
  ];
  const examples = [];
  for (const topic of topics) for (const [position, offset] of [['start',0],['middle',450],['end',1000]]) {
    const filler = topic.filler.repeat(40).slice(0,1200);
    const target = filler.slice(0,offset)+topic.evidence+filler.slice(offset);
    const texts = [topic.distractor+filler.slice(0,650),
      '数据库事务确保一组写入全部提交或全部回滚。'+filler,
      '茶叶库存按批次登记数量，库存量并不等于提取率。'+filler,
      '矩阵的特征向量在线性变换下保持方向不变。'+filler,
      '本页介绍装订和目录校对，没有讨论任何算法或实验。'+filler,
      target,
      '注意阅读记录与日期的对应关系。'+filler,
      'A mutex gives one worker exclusive access to a shared resource. '+filler];
    examples.push({ name: `${topic.name}-${position}`, query: topic.query, expected: 5, position,
      evidence: topic.evidence, texts });
  }
  return examples;
}
