/**
 * Note 领域模型
 * 笔记核心规则
 * - 标题不能为空
 * - 内容哈希用于检测变更
 * - 索引状态管理
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 笔记类型
 */
export enum NoteType {
  MARKDOWN = 'markdown',
  PDF = 'pdf',
  TEXT = 'text',
  SNIPPET = 'snippet',
}

/**
 * 索引状态
 */
export enum IndexStatus {
  PENDING = 'pending',       // 待索引
  PARSING = 'parsing',       // 解析中
  CHUNKING = 'chunking',     // 切分中
  INDEXING = 'indexing',     // 索引中
  INDEXED = 'indexed',       // 已索引
  FAILED = 'failed',         // 失败
  STALE = 'stale',           // 过时（内容或模型版本变更）
}

/**
 * 笔记实体
 */
export interface Note extends Entity {
  title: string;
  type: NoteType;
  content: string;
  contentHash: string;
  sourceUri?: string;
  tags: string[];
  indexStatus: IndexStatus;
  embeddingVersion?: string;
  chunkCount: number;
  indexedAt?: ISO8601DateTime;
  indexError?: string;
}

/**
 * 笔记元数据
 */
export interface NoteMetadata {
  title: string;
  author?: string;
  date?: ISO8601DateTime;
  source?: string;
  tags: string[];
}

/**
 * 创建笔记参数
 */
export interface CreateNoteParams {
  title: string;
  type: NoteType;
  content: string;
  sourceUri?: string;
  tags?: string[];
  metadata?: Partial<NoteMetadata>;
}

/**
 * Note 领域服务
 */
export class NoteDomainService {
  /**
   * 验证标题
   */
  static validateTitle(title: string): void {
    if (!title || title.trim().length === 0) {
      throw new ValidationError('笔记标题不能为空', ['title: 标题不能为空']);
    }
    if (title.length > 500) {
      throw new ValidationError('笔记标题过长', ['title: 标题不能超过 500 字符']);
    }
  }

  /**
   * 验证内容
   */
  static validateContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new ValidationError('笔记内容不能为空', ['content: 内容不能为空']);
    }
  }

  /**
   * 计算内容哈希
   */
  static calculateContentHash(content: string): string {
    // 简单的哈希实现，实际应使用 crypto
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `sha256:${Math.abs(hash).toString(16)}`;
  }

  /**
   * 创建笔记
   */
  static create(
    params: CreateNoteParams,
    id: UUID,
    now: ISO8601DateTime
  ): Note {
    this.validateTitle(params.title);
    this.validateContent(params.content);

    const contentHash = this.calculateContentHash(params.content);

    return {
      id,
      title: params.title.trim(),
      type: params.type,
      content: params.content,
      contentHash,
      sourceUri: params.sourceUri,
      tags: params.tags || [],
      indexStatus: IndexStatus.PENDING,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 更新笔记内容
   */
  static updateContent(
    note: Note,
    newContent: string,
    now: ISO8601DateTime
  ): Note {
    this.validateContent(newContent);

    const newHash = this.calculateContentHash(newContent);
    const contentChanged = newHash !== note.contentHash;

    return {
      ...note,
      content: newContent,
      contentHash: newHash,
      // 如果内容变更，索引状态变为 stale
      indexStatus: contentChanged ? IndexStatus.STALE : note.indexStatus,
      updatedAt: now,
    };
  }

  /**
   * 更新索引状态
   */
  static updateIndexStatus(
    note: Note,
    status: IndexStatus,
    embeddingVersion?: string,
    chunkCount?: number,
    error?: string,
    now?: ISO8601DateTime
  ): Note {
    const updated: Note = {
      ...note,
      indexStatus: status,
      updatedAt: now || note.updatedAt,
    };

    if (embeddingVersion) {
      updated.embeddingVersion = embeddingVersion;
    }

    if (chunkCount !== undefined) {
      updated.chunkCount = chunkCount;
    }

    if (status === IndexStatus.INDEXED) {
      updated.indexedAt = now;
      updated.indexError = undefined;
    }

    if (status === IndexStatus.FAILED && error) {
      updated.indexError = error;
    }

    return updated;
  }

  /**
   * 添加标签
   */
  static addTag(note: Note, tag: string, now: ISO8601DateTime): Note {
    const normalizedTag = tag.trim().toLowerCase();

    if (!normalizedTag) {
      throw new ValidationError('标签不能为空', ['tag: 标签不能为空']);
    }

    if (note.tags.includes(normalizedTag)) {
      return note;
    }

    return {
      ...note,
      tags: [...note.tags, normalizedTag],
      updatedAt: now,
    };
  }

  /**
   * 检查是否需要重新索引
   */
  static needsReindex(note: Note, currentEmbeddingVersion: string): boolean {
    return (
      note.indexStatus === IndexStatus.PENDING ||
      note.indexStatus === IndexStatus.STALE ||
      note.indexStatus === IndexStatus.FAILED ||
      (note.embeddingVersion !== undefined &&
        note.embeddingVersion !== currentEmbeddingVersion)
    );
  }
}
