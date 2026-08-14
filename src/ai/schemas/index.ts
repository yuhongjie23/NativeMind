/**
 * Schema 注册表（§17.2 版本化）
 *
 * 新增 Schema：加 json 文件 → 在 SchemaId 加一项 → 在此注册。
 * 旧版本文件永不删除、永不覆盖，方便定位历史输出的回归。
 */
import type { JsonSchema } from '../evaluation/json-validator';
import type { SchemaId } from '../types';

import intentV1 from './intent.v1.json';
import knowledgeLinkV1 from './knowledge-link.v1.json';
import letterEmotionV1 from './letter-emotion.v1.json';
import letterVerifyV1 from './letter-verify.v1.json';
import linkHydeV1 from './link-hyde.v1.json';
import qaCriticV1 from './qa-critic.v1.json';
import reviewLogV1 from './review-log.v1.json';
import todoV1 from './todo.v1.json';

export const SCHEMAS: Record<SchemaId, JsonSchema> = {
  'intent.v1': intentV1 as JsonSchema,
  'todo.v1': todoV1 as JsonSchema,
  'review-log.v1': reviewLogV1 as JsonSchema,
  'knowledge-link.v1': knowledgeLinkV1 as JsonSchema,
  'link-hyde.v1': linkHydeV1 as JsonSchema,
  'qa-critic.v1': qaCriticV1 as JsonSchema,
  'letter-emotion.v1': letterEmotionV1 as JsonSchema,
  'letter-verify.v1': letterVerifyV1 as JsonSchema,
};

export const getSchema = (id: SchemaId): JsonSchema => SCHEMAS[id];

/**
 * 超过这个长度的 maxLength 不再交给运行时做约束解码。
 *
 * Ollama 把 JSON Schema 编译成 GBNF 语法时，`maxLength: N` 会展开成 N 份可选项，
 * 值一大就编译不出来，整个请求直接 400 "failed to parse grammar"。
 * 实测边界在 1000 与 2000 之间（1000 可用，2000 失败），这里取 1000 并留出余量。
 *
 * 具体影响过的地方：review-log.v1 的 content 是 maxLength 4000，
 * 原样传过去会让「生成复盘」每次都拿不到模型输出、静默落到降级文案。
 */
const MAX_SAFE_MAX_LENGTH = 1000;

/**
 * 生成「只用于约束解码」的 Schema 副本。
 *
 * 与校验用的 Schema 刻意分开：校验必须保持原样（那是真正的业务契约），
 * 这里只是给运行时的提示，去掉它编译不了的约束不会放松最终校验 ——
 * 事后仍会用完整 Schema 校验一次。
 */
export const toDecodingSchema = (schema: JsonSchema): JsonSchema => {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // 大 maxLength 会让 GBNF 展开爆炸，丢掉它换取整个请求能跑起来
      if (key === 'maxLength' && typeof value === 'number' && value > MAX_SAFE_MAX_LENGTH) continue;
      result[key] = walk(value);
    }
    return result;
  };

  return walk(schema) as JsonSchema;
};


