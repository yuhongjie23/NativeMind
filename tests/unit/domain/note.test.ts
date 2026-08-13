/**
 * Note 领域规则单测
 * 内容哈希、索引状态机、重建判定。
 */
import { describe, expect, it } from 'vitest';
import { IndexStatus, NoteDomainService, NoteType } from '@domain/note';
import { ValidationError } from '@shared-types/common';

const create = () =>
  NoteDomainService.create(
    {
      title: 'LoRA 笔记',
      type: NoteType.MARKDOWN,
      content: '低秩适配的核心思想',
    },
    'note_1',
    '2026-08-02T09:00:00.000Z'
  );

describe('NoteDomainService 校验', () => {
  it('标题与内容不能为空', () => {
    expect(() => NoteDomainService.validateTitle('')).toThrow(ValidationError);
    expect(() => NoteDomainService.validateTitle('x'.repeat(501))).toThrow(ValidationError);
    expect(() => NoteDomainService.validateContent('')).toThrow(ValidationError);
  });
});

describe('NoteDomainService 创建与哈希', () => {
  it('create 后是 pending 且 chunkCount 为 0', () => {
    const note = create();
    expect(note.indexStatus).toBe(IndexStatus.PENDING);
    expect(note.chunkCount).toBe(0);
    expect(note.contentHash.startsWith('sha256:')).toBe(true);
  });

  it('同内容哈希相同，异内容哈希不同', () => {
    const a = NoteDomainService.calculateContentHash('hello');
    const b = NoteDomainService.calculateContentHash('hello');
    const c = NoteDomainService.calculateContentHash('world');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('NoteDomainService 索引状态机', () => {
  it('内容变更后索引状态变为 stale', () => {
    const changed = NoteDomainService.updateContent(create(), '新的正文', '2026-08-02T10:00:00Z');
    expect(changed.indexStatus).toBe(IndexStatus.STALE);
    expect(changed.contentHash).not.toBe(create().contentHash);
  });

  it('内容未变不改变索引状态', () => {
    const note = create();
    const untouched = NoteDomainService.updateContent(note, note.content, '2026-08-02T10:00:00Z');
    expect(untouched.indexStatus).toBe(IndexStatus.PENDING);
  });

  it('索引完成会记录 indexedAt 并清除错误', () => {
    const failed = NoteDomainService.updateIndexStatus(
      create(),
      IndexStatus.FAILED,
      undefined,
      undefined,
      '切分失败'
    );
    const done = NoteDomainService.updateIndexStatus(
      failed,
      IndexStatus.INDEXED,
      'bge-small-zh-v1.5',
      12,
      undefined,
      '2026-08-02T10:05:00Z'
    );
    expect(done.indexStatus).toBe(IndexStatus.INDEXED);
    expect(done.embeddingVersion).toBe('bge-small-zh-v1.5');
    expect(done.chunkCount).toBe(12);
    expect(done.indexedAt).toBe('2026-08-02T10:05:00Z');
    expect(done.indexError).toBeUndefined();
  });

  it('失败状态记录错误原因', () => {
    const failed = NoteDomainService.updateIndexStatus(
      create(),
      IndexStatus.FAILED,
      undefined,
      undefined,
      'embedding 模型不可用'
    );
    expect(failed.indexError).toBe('embedding 模型不可用');
  });
});

describe('NoteDomainService.needsReindex', () => {
  it('pending / stale / failed 都需要重建', () => {
    const pending = create();
    const stale = { ...pending, indexStatus: IndexStatus.STALE };
    const failed = { ...pending, indexStatus: IndexStatus.FAILED };
    expect(NoteDomainService.needsReindex(pending, 'v1')).toBe(true);
    expect(NoteDomainService.needsReindex(stale, 'v1')).toBe(true);
    expect(NoteDomainService.needsReindex(failed, 'v1')).toBe(true);
  });

  it('embedding 版本不匹配时也要重建', () => {
    const indexed = { ...create(), indexStatus: IndexStatus.INDEXED, embeddingVersion: 'v0' };
    expect(NoteDomainService.needsReindex(indexed, 'v1')).toBe(true);
  });

  it('已索引且版本一致不需要重建', () => {
    const indexed = { ...create(), indexStatus: IndexStatus.INDEXED, embeddingVersion: 'v1' };
    expect(NoteDomainService.needsReindex(indexed, 'v1')).toBe(false);
  });
});
