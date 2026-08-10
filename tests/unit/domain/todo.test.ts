/**
 * Todo 领域规则单测
 * 状态流转、标题/时长校验、标签去重。
 */
import { describe, expect, it } from 'vitest';
import { TodoDomainService, TodoPriority, TodoStatus } from '@domain/todo';
import { ValidationError } from '@shared-types/common';

const create = () =>
  TodoDomainService.create(
    { title: '理解 LoRA 与 QLoRA 的区别', priority: TodoPriority.HIGH, estimatedMinutes: 30 },
    'todo_1',
    '2026-08-02T09:00:00.000Z'
  );

describe('TodoDomainService.validateTitle', () => {
  it('拒绝空标题与纯空白', () => {
    expect(() => TodoDomainService.validateTitle('')).toThrow(ValidationError);
    expect(() => TodoDomainService.validateTitle('   ')).toThrow(ValidationError);
  });

  it('拒绝超过 200 字符的标题', () => {
    expect(() => TodoDomainService.validateTitle('x'.repeat(201))).toThrow(ValidationError);
    expect(() => TodoDomainService.validateTitle('x'.repeat(200))).not.toThrow();
  });
});

describe('TodoDomainService.validateEstimatedMinutes', () => {
  it('拒绝非正时长', () => {
    expect(() => TodoDomainService.validateEstimatedMinutes(0)).toThrow(ValidationError);
    expect(() => TodoDomainService.validateEstimatedMinutes(-5)).toThrow(ValidationError);
  });

  it('缺省与正数都合法', () => {
    expect(() => TodoDomainService.validateEstimatedMinutes(undefined)).not.toThrow();
    expect(() => TodoDomainService.validateEstimatedMinutes(25)).not.toThrow();
  });
});

describe('TodoDomainService 状态流转', () => {
  it('create 后是 pending，medium 为默认优先级', () => {
    const todo = TodoDomainService.create({ title: '随便一条' }, 'todo_2', '2026-08-02T00:00:00Z');
    expect(todo.status).toBe(TodoStatus.PENDING);
    expect(todo.priority).toBe(TodoPriority.MEDIUM);
    expect(todo.linkedNoteIds).toEqual([]);
  });

  it('pending 可以进入 in_progress / completed / abandoned', () => {
    expect(TodoDomainService.canTransitionTo(TodoStatus.PENDING, TodoStatus.IN_PROGRESS)).toBe(true);
    expect(TodoDomainService.canTransitionTo(TodoStatus.PENDING, TodoStatus.COMPLETED)).toBe(true);
    expect(TodoDomainService.canTransitionTo(TodoStatus.PENDING, TodoStatus.ABANDONED)).toBe(true);
  });

  it('completed 之后不能再转换', () => {
    expect(TodoDomainService.canTransitionTo(TodoStatus.COMPLETED, TodoStatus.PENDING)).toBe(false);
    expect(() =>
      TodoDomainService.validateStatusTransition(TodoStatus.COMPLETED, TodoStatus.IN_PROGRESS)
    ).toThrow(ValidationError);
  });

  it('abandoned 只能重新激活为 pending', () => {
    expect(TodoDomainService.canTransitionTo(TodoStatus.ABANDONED, TodoStatus.PENDING)).toBe(true);
    expect(TodoDomainService.canTransitionTo(TodoStatus.ABANDONED, TodoStatus.COMPLETED)).toBe(false);
  });

  it('转为 completed 时记录完成时间', () => {
    const todo = TodoDomainService.updateStatus(create(), TodoStatus.COMPLETED, '2026-08-02T10:00:00Z');
    expect(todo.status).toBe(TodoStatus.COMPLETED);
    expect(todo.completedAt).toBe('2026-08-02T10:00:00Z');
  });
});

describe('TodoDomainService 标签与笔记关联', () => {
  it('添加标签时归一化并去重', () => {
    const todo = create();
    const once = TodoDomainService.addTag(todo, ' LLM ', '2026-08-02T10:00:00Z');
    expect(once.tags).toEqual(['llm']);
    const twice = TodoDomainService.addTag(once, 'LLM', '2026-08-02T10:00:00Z');
    expect(twice.tags).toEqual(['llm']);
  });

  it('拒绝空标签', () => {
    expect(() => TodoDomainService.addTag(create(), '   ', '2026-08-02T10:00:00Z')).toThrow(
      ValidationError
    );
  });

  it('同一篇笔记不重复关联', () => {
    const todo = TodoDomainService.linkNote(create(), 'note_1', '2026-08-02T10:00:00Z');
    const again = TodoDomainService.linkNote(todo, 'note_1', '2026-08-02T10:00:00Z');
    expect(again.linkedNoteIds).toEqual(['note_1']);
  });
});
