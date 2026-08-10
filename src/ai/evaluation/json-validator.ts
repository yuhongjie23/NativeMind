/**
 * JSON Schema 校验器（C5：脏数据不得落库）
 *
 * 只实现 draft-07 的常用子集，够覆盖 ai/schemas 下的四个 Schema，且零依赖。
 * 后续如果 Schema 用到 oneOf / $ref / pattern 这类高级特性，
 * 换成 ajv 只需替换本文件的 validate 实现，调用方不受影响。
 */
import type { ValidationOutcome } from '../types';

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  /** 以下字段仅作文档用途，校验时忽略 */
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
}

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const matchesType = (value: unknown, type: NonNullable<JsonSchema['type']>): boolean => {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
};

/** 递归收集错误。path 用点号路径，便于定位到具体字段 */
const collect = (value: unknown, schema: JsonSchema, path: string, errors: string[]): void => {
  const at = path || '(root)';

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${at}: 期望 ${schema.type}，实际 ${typeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(`${at}: 值 ${JSON.stringify(value)} 不在允许集合内`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: 长度 ${value.length} 小于最小值 ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: 长度 ${value.length} 超过最大值 ${schema.maxLength}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: ${value} 小于最小值 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: ${value} 超过最大值 ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: 至少需要 ${schema.minItems} 项，实际 ${value.length}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: 最多 ${schema.maxItems} 项，实际 ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, i) => collect(item, schema.items as JsonSchema, `${path}[${i}]`, errors));
    }
    return;
  }

  if (typeOf(value) === 'object') {
    const record = value as Record<string, unknown>;

    schema.required?.forEach((key) => {
      if (record[key] === undefined) errors.push(`${at}: 缺少必填字段 ${key}`);
    });

    Object.entries(schema.properties ?? {}).forEach(([key, sub]) => {
      if (record[key] !== undefined) collect(record[key], sub, path ? `${path}.${key}` : key, errors);
    });

    // properties 未覆盖的键：false 表示禁止，给出 Schema 则逐个按它校验
    // （intent.v1 的 entities 就依赖后者来约束值必须是字符串）
    const extraKeys = Object.keys(record).filter((key) => !(key in (schema.properties ?? {})));

    if (schema.additionalProperties === false) {
      extraKeys.forEach((key) => errors.push(`${at}: 不允许的额外字段 ${key}`));
    } else if (typeOf(schema.additionalProperties) === 'object') {
      const sub = schema.additionalProperties as JsonSchema;
      extraKeys.forEach((key) =>
        collect(record[key], sub, path ? `${path}.${key}` : key, errors)
      );
    }
  }
};

/** 把 Schema 里声明的 default 补进对象，避免下游到处判 undefined */
const applyDefaults = <T>(value: T, schema: JsonSchema): T => {
  if (Array.isArray(value) && schema.items) {
    return value.map((item) => applyDefaults(item, schema.items as JsonSchema)) as unknown as T;
  }

  if (typeOf(value) === 'object' && schema.properties) {
    const filled = { ...(value as Record<string, unknown>) };
    Object.entries(schema.properties).forEach(([key, sub]) => {
      if (filled[key] === undefined && sub.default !== undefined) filled[key] = sub.default;
      else if (filled[key] !== undefined) filled[key] = applyDefaults(filled[key], sub);
    });
    return filled as unknown as T;
  }

  return value;
};

export function validateAgainstSchema<O>(value: unknown, schema: JsonSchema): ValidationOutcome<O> {
  const errors: string[] = [];
  collect(value, schema, '', errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: applyDefaults(value, schema) as O };
}
