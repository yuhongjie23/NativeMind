/**
 * NoteChunk 领域模型
 * 笔记切分片段
 * 用于 RAG 检索和 embedding
 */

import { Entity, UUID, ISO8601DateTime, ValidationError } from '@shared-types/common';

/**
 * 笔记切片实体
 */
export interface NoteChunk extends Entity {
  noteId: UUID;
  text: string;
  headingPath: string[];  // 层级标题路径，如 ["大模型微调", "QLoRA"]
  page?: number;          // PDF 页码
  position: number;       // 在笔记中的位置（序号）
  tags: string[];
  sourceUri?: string;
  embeddingVersion?: string;
  embedding?: number[];   // 向量
}

/**
 * 创建笔记切片参数
 */
export interface CreateNoteChunkParams {
  noteId: UUID;
  text: string;
  headingPath?: string[];
  page?: number;
  position: number;
  tags?: string[];
  sourceUri?: string;
}

/**
 * NoteChunk 领域服务
 */
export class NoteChunkDomainService {
  /**
   * 验证切片文本
   */
  static validateText(text: string): void {
    if (!text || text.trim().length === 0) {
      throw new ValidationError('切片文本不能为空', ['text: 文本不能为空']);
    }
    // 切片不宜过短或过长
    if (text.length < 50) {
      throw new ValidationError('切片文本过短', ['text: 文本不应少于 50 字符']);
    }
    if (text.length > 5000) {
      throw new ValidationError('切片文本过长', ['text: 文本不应超过 5000 字符']);
    }
  }

  /**
   * 创建笔记切片
   */
  static create(
    params: CreateNoteChunkParams,
    id: UUID,
    now: ISO8601DateTime
  ): NoteChunk {
    this.validateText(params.text);

    return {
      id,
      noteId: params.noteId,
      text: params.text,
      headingPath: params.headingPath || [],
      page: params.page,
      position: params.position,
      tags: params.tags || [],
      sourceUri: params.sourceUri,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 检查是否需要重新 embedding
   */
  static needsEmbedding(
    chunk: NoteChunk,
    currentEmbeddingVersion: string
  ): boolean {
    return (
      !chunk.embedding ||
      !chunk.embeddingVersion ||
      chunk.embeddingVersion !== currentEmbeddingVersion
    );
  }
}
