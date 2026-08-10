/**
 * SocraticSession 领域规则单测
 * 话题/问题校验、提问序列、未答计数。
 */
import { describe, expect, it } from 'vitest';
import {
  QuestionType,
  SocraticSessionDomainService,
  SocraticSessionStatus,
} from '@domain/socratic';
import { ValidationError } from '@shared-types/common';

const create = () =>
  SocraticSessionDomainService.create(
    {
      userId: 'user_1',
      topic: '反向传播',
      goalDescription: '想理解反向传播的梯度是怎么算出来的',
    },
    'session_1',
    '2026-08-02T09:00:00.000Z'
  );

const addQuestion = (session = create(), id = 'q_1') =>
  SocraticSessionDomainService.addQuestion(
    session,
    { type: QuestionType.CLARIFICATION, question: '先说说你对梯度的理解？' },
    id,
    '2026-08-02T09:05:00.000Z'
  );

describe('SocraticSessionDomainService 校验', () => {
  it('主题与目标描述不能为空', () => {
    expect(() => SocraticSessionDomainService.validateTopic('')).toThrow(ValidationError);
    expect(() => SocraticSessionDomainService.validateGoalDescription('  ')).toThrow(
      ValidationError
    );
  });

  it('问题不能为空或超长', () => {
    expect(() => SocraticSessionDomainService.validateQuestion('')).toThrow(ValidationError);
    expect(() => SocraticSessionDomainService.validateQuestion('x'.repeat(501))).toThrow(
      ValidationError
    );
  });
});

describe('SocraticSessionDomainService 提问序列', () => {
  it('create 后是 active，问题列表为空', () => {
    const session = create();
    expect(session.status).toBe(SocraticSessionStatus.ACTIVE);
    expect(session.questions).toEqual([]);
  });

  it('只能给进行中的会话加问题', () => {
    const done = SocraticSessionDomainService.complete(create(), '2026-08-02T09:30:00Z');
    expect(() =>
      SocraticSessionDomainService.addQuestion(
        done,
        { type: QuestionType.EXAMPLE, question: '举个例子？' },
        'q_9',
        '2026-08-02T09:31:00Z'
      )
    ).toThrow(ValidationError);
  });

  it('有未回答问题时不能追加新问题', () => {
    const withOne = addQuestion();
    expect(SocraticSessionDomainService.canAddQuestion(withOne)).toBe(false);
    expect(SocraticSessionDomainService.getUnansweredCount(withOne)).toBe(1);
  });

  it('回答后未答数归零，才能继续追问', () => {
    const withOne = addQuestion();
    const answered = SocraticSessionDomainService.answerQuestion(
      withOne,
      'q_1',
      '梯度是损失对参数的导数',
      '对，那链式法则怎么用它？',
      '2026-08-02T09:10:00Z'
    );
    expect(SocraticSessionDomainService.getUnansweredCount(answered)).toBe(0);
    expect(SocraticSessionDomainService.canAddQuestion(answered)).toBe(true);
  });

  it('回答不存在的问题会报错', () => {
    expect(() =>
      SocraticSessionDomainService.answerQuestion(
        create(),
        'q_missing',
        '答案',
        undefined,
        '2026-08-02T09:10:00Z'
      )
    ).toThrow(ValidationError);
  });

  it('最后一个问题是最近提出的', () => {
    const session = addQuestion(addQuestion(create(), 'q_1'), 'q_2');
    expect(SocraticSessionDomainService.getLastQuestion(session)?.id).toBe('q_2');
  });

  it('完成与放弃会记录结束时间', () => {
    const done = SocraticSessionDomainService.complete(create(), '2026-08-02T09:30:00Z');
    expect(done.status).toBe(SocraticSessionStatus.COMPLETED);
    expect(done.completedAt).toBe('2026-08-02T09:30:00Z');

    const abandoned = SocraticSessionDomainService.abandon(create(), '2026-08-02T09:20:00Z');
    expect(abandoned.status).toBe(SocraticSessionStatus.ABANDONED);
  });
});
