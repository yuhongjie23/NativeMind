/**
 * node:sqlite 的类型声明。
 *
 * @types/node@20 尚未收录 node:sqlite（Node 22.5+ 内置），这里给出
 * 集成测试实际用到的极小面。若后续升级 @types/node 已自带类型，
 * 本文件可整体删除（同名模块声明会与之冲突）。
 */

declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
