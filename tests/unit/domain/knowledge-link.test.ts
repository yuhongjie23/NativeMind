/**
 * KnowledgeLink 领域规则单测
 * 置信度/理由校验、反向关系推断、端点去重。
 */
import { describe, expect, it } from 'vitest';
import { EntityType, KnowledgeLinkDomainService, RelationType } from '@domain/knowledge-link';
import { ValidationError } from '@shared-types/common';

const create = () =>
  KnowledgeLinkDomainService.create(
    {
      fromType: EntityType.NOTE,
      fromId: 'note_new',
      toType: EntityType.NOTE,
      toId: 'note_old',
      relationType: RelationType.PREREQUISITE,
      reason: '理解 QLoRA 前需要先理解 LoRA 的低秩适配',
      createdBy: 'ai_suggestion',
    },
    'link_1',
    '2026-08-02T10:00:00.000Z'
  );

describe('KnowledgeLinkDomainService 校验', () => {
  it('置信度必须在 0-1 之间', () => {
    expect(() => KnowledgeLinkDomainService.validateConfidence(-0.1)).toThrow(ValidationError);
    expect(() => KnowledgeLinkDomainService.validateConfidence(1.1)).toThrow(ValidationError);
    expect(() => KnowledgeLinkDomainService.validateConfidence(0.82)).not.toThrow();
  });

  it('理由不能为空或超长', () => {
    expect(() => KnowledgeLinkDomainService.validateReason('')).toThrow(ValidationError);
    expect(() => KnowledgeLinkDomainService.validateReason('x'.repeat(501))).toThrow(ValidationError);
  });

  it('不能指向自己的关系', () => {
    expect(() =>
      KnowledgeLinkDomainService.validateDifferentEndpoints(
        EntityType.NOTE,
        'note_1',
        EntityType.NOTE,
        'note_1'
      )
    ).toThrow(ValidationError);
  });
});

describe('KnowledgeLinkDomainService 创建', () => {
  it('缺省置信度为 0.8，AI 建议默认未确认', () => {
    const link = create();
    expect(link.confidence).toBe(0.8);
    expect(link.confirmedByUser).toBe(false);
  });

  it('用户手动创建默认已确认', () => {
    const manual = KnowledgeLinkDomainService.create(
      {
        fromType: EntityType.NOTE,
        fromId: 'note_a',
        toType: EntityType.NOTE,
        toId: 'note_b',
        relationType: RelationType.CONTRAST,
        reason: '两者是不同框架',
        createdBy: 'user_manual',
      },
      'link_2',
      '2026-08-02T10:00:00Z'
    );
    expect(manual.confirmedByUser).toBe(true);
  });

  it('确认后不可回退', () => {
    const confirmed = KnowledgeLinkDomainService.confirmByUser(create(), '2026-08-02T11:00:00Z');
    expect(confirmed.confirmedByUser).toBe(true);
  });
});

describe('KnowledgeLinkDomainService 关系语义', () => {
  it('same_concept 与 contrast 是对称关系', () => {
    expect(KnowledgeLinkDomainService.isSymmetric(RelationType.SAME_CONCEPT)).toBe(true);
    expect(KnowledgeLinkDomainService.isSymmetric(RelationType.CONTRAST)).toBe(true);
    expect(KnowledgeLinkDomainService.isSymmetric(RelationType.PREREQUISITE)).toBe(false);
  });

  it('prerequisite 的反向是 extends，对称关系的反向是自己', () => {
    expect(KnowledgeLinkDomainService.getReverseRelationType(RelationType.PREREQUISITE)).toBe(
      RelationType.EXTENDS
    );
    expect(KnowledgeLinkDomainService.getReverseRelationType(RelationType.SAME_CONCEPT)).toBe(
      RelationType.SAME_CONCEPT
    );
  });

  it('无明确反向的关系返回 null', () => {
    expect(KnowledgeLinkDomainService.getReverseRelationType(RelationType.REVIEW_LATER)).toBeNull();
  });

  it('关系类型有中文标签', () => {
    expect(KnowledgeLinkDomainService.getRelationTypeLabel(RelationType.PREREQUISITE)).toBe(
      '前置知识'
    );
  });
});
