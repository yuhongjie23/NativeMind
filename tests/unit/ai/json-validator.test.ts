/**
 * Schema 校验测试（C5：脏数据不得落库）
 *
 * 重点验证四个正式 Schema 能挡住小模型的典型翻车：
 * 枚举瞎编、字段缺失、类型不对、数量超限。
 */
import { describe, expect, it } from 'vitest';
import { validateAgainstSchema } from '@ai/evaluation/json-validator';
import { getSchema } from '@ai/schemas';

const intentSchema = getSchema('intent.v1');
const todoSchema = getSchema('todo.v1');
const reviewSchema = getSchema('review-log.v1');
const linkSchema = getSchema('knowledge-link.v1');

/** 取出错误信息拼成一条，便于断言关键词 */
const errorsOf = (value: unknown, schema = intentSchema): string => {
  const result = validateAgainstSchema(value, schema);
  return result.ok ? '' : result.errors.join(' | ');
};

describe('intent.v1', () => {
  it('接受合法输出', () => {
    const result = validateAgainstSchema<{ intent: string; confidence: number }>(
      { intent: 'start_focus', confidence: 0.8, entities: { topic: 'LoRA' } },
      intentSchema
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intent).toBe('start_focus');
  });

  it('拒绝枚举外的意图（C9）', () => {
    expect(errorsOf({ intent: 'play_music', confidence: 0.9 })).toContain('不在允许集合内');
  });

  it('拒绝超出 0-1 的置信度', () => {
    expect(errorsOf({ intent: 'other', confidence: 1.5 })).toContain('超过最大值');
  });

  it('拒绝缺失必填字段', () => {
    expect(errorsOf({ intent: 'other' })).toContain('缺少必填字段 confidence');
  });

  it('拒绝多出来的字段，避免脏数据混入', () => {
    expect(errorsOf({ intent: 'other', confidence: 0.5, extra: 'x' })).toContain('不允许的额外字段');
  });

  it('entities 的值必须是字符串', () => {
    expect(errorsOf({ intent: 'other', confidence: 0.5, entities: { topic: 42 } })).toContain(
      'entities.topic'
    );
  });
});

describe('todo.v1', () => {
  const validTodo = { title: '读 LoRA 论文第 3 节', priority: 'medium', estimatedMinutes: 25 };

  it('接受合法任务列表', () => {
    expect(validateAgainstSchema([validTodo], todoSchema).ok).toBe(true);
  });

  it('拒绝空数组：拆解不出任务应走失败分支，而非产出空建议', () => {
    expect(errorsOf([], todoSchema)).toContain('至少需要 1 项');
  });

  it('拒绝超过 5 个任务，防止一天塞太满', () => {
    expect(errorsOf(Array(6).fill(validTodo), todoSchema)).toContain('最多 5 项');
  });

  it('拒绝枚举外的优先级', () => {
    expect(errorsOf([{ ...validTodo, priority: '紧急' }], todoSchema)).toContain('不在允许集合内');
  });

  it('拒绝非整数时长', () => {
    expect(errorsOf([{ ...validTodo, estimatedMinutes: 25.5 }], todoSchema)).toContain('期望 integer');
  });

  it('错误路径带数组下标，便于定位是哪条任务', () => {
    expect(errorsOf([validTodo, { title: '' }], todoSchema)).toContain('[1].title');
  });

  it('拒绝超过 3 个标签', () => {
    expect(errorsOf([{ ...validTodo, tags: ['a', 'b', 'c', 'd'] }], todoSchema)).toContain('最多 3 项');
  });
});

describe('review-log.v1', () => {
  const validReview = {
    content: '今天完成 2 个任务，专注 50 分钟，LoRA 那个任务中断了一次。',
    insights: [],
    nextTodos: [],
  };

  it('接受 insights / nextTodos 为空数组（宁缺勿滥）', () => {
    expect(validateAgainstSchema(validReview, reviewSchema).ok).toBe(true);
  });

  it('拒绝过短的正文，避免模型敷衍一句话', () => {
    expect(errorsOf({ ...validReview, content: '还行' }, reviewSchema)).toContain('小于最小值');
  });

  it('拒绝超过 3 条的后续任务建议', () => {
    expect(errorsOf({ ...validReview, nextTodos: ['a', 'b', 'c', 'd'] }, reviewSchema)).toContain(
      '最多 3 项'
    );
  });
});

describe('knowledge-link.v1', () => {
  const validLink = {
    toId: 'chunk_042',
    relationType: 'prerequisite',
    reason: '理解 QLoRA 前需要先掌握 LoRA 的低秩适配',
    confidence: 0.82,
  };

  it('接受合法建议并补上 toType 默认值', () => {
    const result = validateAgainstSchema<{ toType: string }[]>([validLink], linkSchema);

    expect(result.ok).toBe(true);
    // Schema 里声明了 default: chunk，校验器负责补齐
    if (result.ok) expect(result.value[0].toType).toBe('chunk');
  });

  it('接受空数组：没有可靠关系时不硬凑', () => {
    expect(validateAgainstSchema([], linkSchema).ok).toBe(true);
  });

  it('拒绝模型自创的关系类型（C9）', () => {
    expect(errorsOf([{ ...validLink, relationType: '有点像' }], linkSchema)).toContain(
      '不在允许集合内'
    );
  });

  it('拒绝缺少理由的建议：用户需要知道为什么相关', () => {
    const { reason, ...withoutReason } = validLink;
    void reason;
    expect(errorsOf([withoutReason], linkSchema)).toContain('缺少必填字段 reason');
  });

  it('拒绝枚举外的端点类型', () => {
    expect(errorsOf([{ ...validLink, toType: 'webpage' }], linkSchema)).toContain('不在允许集合内');
  });
});

describe('校验器基础行为', () => {
  it('类型不符时不再往下报噪音错误', () => {
    const result = validateAgainstSchema('不是对象', intentSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(1);
  });

  it('一次收集多条错误，便于回灌给模型', () => {
    const result = validateAgainstSchema({ confidence: 5 }, intentSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });

  it('null 不被当作对象通过', () => {
    expect(validateAgainstSchema(null, intentSchema).ok).toBe(false);
  });
});
