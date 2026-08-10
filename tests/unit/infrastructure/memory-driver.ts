/**
 * 测试用内存 SqlDriver
 *
 * 不实现 SQL 引擎，只识别 Repository / JobQueue 实际用到的语句形状，
 * 目的是验证「状态流转和调用顺序」，真实 SQL 行为交给集成测试。
 */
import type { SqlDriver, SqlParam, SqlRow } from '@infrastructure/db/database';

export interface RecordedCall {
  sql: string;
  params: SqlParam[];
}

export class MemoryDriver implements SqlDriver {
  readonly calls: RecordedCall[] = [];
  /** 按「SQL 片段 → 返回行」预设查询结果 */
  private readonly stubs: { match: string; rows: SqlRow[] }[] = [];

  stub(match: string, rows: SqlRow[]): this {
    this.stubs.push({ match, rows });
    return this;
  }

  async select(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    this.calls.push({ sql, params });
    // 后注册的 stub 优先，方便同一个测试里改变返回值
    const hit = [...this.stubs].reverse().find((stub) => sql.includes(stub.match));
    return hit ? hit.rows : [];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<number> {
    this.calls.push({ sql, params });
    return 1;
  }

  async transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    return work(this);
  }

  /** 便于断言：某类语句被调用了几次 */
  countMatching(fragment: string): number {
    return this.calls.filter((call) => call.sql.includes(fragment)).length;
  }

  findCall(fragment: string): RecordedCall | undefined {
    return this.calls.find((call) => call.sql.includes(fragment));
  }
}
