/**
 * Prompt 注册表（§17.2 版本化）
 *
 * 模板用 Markdown 写，`## System` / `## User` 两段分别对应模型的 system 与 user 消息。
 * 变量占位符是 {{name}}，由 fillTemplate 渲染。
 *
 * 新增 Prompt：加 .v1.md 文件 → 在 PromptId 加一项 → 在此注册。
 * 改语义就升版本（新建 .v2.md），不要覆盖旧文件。
 */
import { fillTemplate } from '../shared/utils';
import type { PromptId } from '../types';

import intentV1 from './intent.v1.md?raw';
import queryRewriteV1 from './query-rewrite.v1.md?raw';
import ragRelationV1 from './rag-relation.v1.md?raw';
import reviewDailyV1 from './review-daily.v1.md?raw';
import socraticV1 from './socratic.v1.md?raw';
import todoStructuringV1 from './todo-structuring.v1.md?raw';

const RAW_PROMPTS: Record<PromptId, string> = {
  'intent.v1': intentV1,
  'todo-structuring.v1': todoStructuringV1,
  'review-daily.v1': reviewDailyV1,
  'rag-relation.v1': ragRelationV1,
  'socratic.v1': socraticV1,
  'query-rewrite.v1': queryRewriteV1,
};

export interface RenderedPrompt {
  system: string;
  user: string;
}

export type PromptVars = Record<string, string | number | undefined>;

/**
 * 按 `## System` / `## User` 切分模板；缺 User 段时整体作为 user 内容。
 *
 * 结尾锚点必须写 `$(?![\s\S])` 而不是 `\Z`：JS 正则没有 `\Z`，
 * 那样写会被当成字面量字符 "Z"。于是「到文档结尾」这一分支永远匹配不上，
 * User 段（文件最后一段）整段落空，fallback 把**整个 markdown**塞给 user，
 * 连 System 段和 HTML 注释一起喂给模型。
 * 有 `m` 标志时 `$` 会匹配每个换行前的位置，所以还要用 `(?![\s\S])` 限定「后面真的没内容」。
 */
const splitSections = (markdown: string): RenderedPrompt => {
  const system = markdown.match(/^##\s*System\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);
  const user = markdown.match(/^##\s*User\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);


  return {
    system: (system?.[1] ?? '').trim(),
    user: (user?.[1] ?? markdown).trim(),
  };
};

export function renderPrompt(id: PromptId, vars: PromptVars = {}): RenderedPrompt {
  const raw = RAW_PROMPTS[id];
  if (!raw) throw new Error(`未注册的 Prompt: ${id}`);

  const { system, user } = splitSections(raw);
  return { system: fillTemplate(system, vars), user: fillTemplate(user, vars) };
}

export const getRawPrompt = (id: PromptId): string => RAW_PROMPTS[id];
