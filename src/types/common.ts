/**
 * 通用类型定义
 */

export type UUID = string;
export type ISO8601DateTime = string;

/**
 * 领域实体基类
 */
export interface Entity {
  id: UUID;
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * 领域错误
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/**
 * 验证错误
 */
export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
