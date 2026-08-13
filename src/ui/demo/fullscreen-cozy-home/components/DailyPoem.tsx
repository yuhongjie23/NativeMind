/**
 * 每日激励诗句（"今天"子界面标题右侧）。
 *
 * 从 public/poems/*.txt 语料库中，按本地日期做种子随机选一句：
 * 当天固定（刷新不变），隔天换一句。读取失败或语料为空时静默不渲染，
 * 不影响面板本身。
 */
import { useEffect, useState } from 'react';

const POEM_FILES = [
  'classical-1.txt',
  'classical-2.txt',
  'idioms-1.txt',
  'idioms-2.txt',
  'modern-quotes.txt',
  'revolution.txt',
  'supplement.txt',
] as const;

/** 本地日期 YYYY-MM-DD，作为"每天"的种子 */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 字符串 → [0,1) 确定性伪随机（xmur3 混合） */
function seededRandom(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
}

/** 去掉行内出处（—— 之后），只保留诗句本体 */
function stripSource(line: string): string {
  const idx = line.indexOf('——');
  return (idx >= 0 ? line.slice(0, idx) : line).trim();
}

export function DailyPoem() {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dayKey = localDateKey(new Date());

    void (async () => {
      try {
        // 第一步：用日期种子选语料文件
        const file = POEM_FILES[Math.floor(seededRandom(dayKey) * POEM_FILES.length)];
        const res = await fetch(`/poems/${file}`, { cache: 'no-cache' });
        if (!res.ok) return;
        const text = await res.text();

        const lines = text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('#'));
        if (lines.length === 0) return;

        // 第二步：文件 + 日期再做一次种子选句
        const picked = lines[Math.floor(seededRandom(`${dayKey}/${file}`) * lines.length)];
        const poem = stripSource(picked);
        if (!cancelled && poem) setLine(poem);
      } catch {
        // 读取失败静默：面板照常显示，只是没有诗句
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!line) return null;
  return (
    <span className="demo-sheet__poem" title={line}>
      {line}
    </span>
  );
}
