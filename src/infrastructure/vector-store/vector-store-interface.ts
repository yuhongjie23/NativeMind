/**
 * 向量库 Provider 接口（C7）
 *
 * ai 层的 VectorStorePort 只需要 query；索引流水线还要写入和删除，
 * 所以这里扩一层 VectorStoreProvider，两边共用同一套 VectorMatch。
 */
import type { VectorMatch, VectorStorePort } from '@ai/types';

export type { VectorMatch, VectorStorePort };

export interface VectorRecord {
  chunkId: string;
  noteId: string;
  text: string;
  embedding: number[];
}

export interface VectorStoreProvider extends VectorStorePort {
  /** Provider 名，写日志和设置页展示用 */
  readonly name: string;
  /** 向量维度。和 embedding 模型不匹配时应拒绝写入，避免污染索引 */
  readonly dimension: number;

  /** 库不可用（扩展没装、服务没起）时返回 false，调用方降级到关键词检索（C3） */
  isAvailable(): Promise<boolean>;
  /** 本次会话是否因「向量维度/模型变化」清空并重建过（装配层据此把 stale 笔记重新入队） */
  readonly didRebuild: boolean;
  upsert(records: VectorRecord[]): Promise<void>;
  deleteByNote(noteId: string): Promise<void>;
  /** embedding 版本升级时整体重建 */
  clear(): Promise<void>;
}

/** 余弦相似度。两个向量长度不一致时返回 0，当作不相关而不是抛错 */
export const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

/**
 * 距离转相似度分数。
 * sqlite-vec / Chroma 返回的是 L2 距离，越小越像；
 * 上层统一按 0-1 越大越像来比阈值，所以这里做一次归一。
 */
export const distanceToScore = (distance: number): number => {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return 1 / (1 + distance);
};
