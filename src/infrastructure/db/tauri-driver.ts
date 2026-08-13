/**
 * Tauri SqlDriver：SQL 实际在 Rust 侧执行，前端只发命令（C7）
 *
 * 这里刻意不 import @tauri-apps/api，而是把 invoke 作为构造参数注入：
 * 浏览器端跑 vitest 时没有 Tauri 运行时，import 会直接炸。
 *
 * 串行队列：**所有**语句（select / execute / 事务的 BEGIN…COMMIT）都排进同一条
 * 队列。否则后台 job 的非事务写会落进某个已 BEGIN 未 COMMIT 的事务里 ——
 * 事务失败回滚时把那条「已成功」的后台写也连带回滚（笔记状态永久错）。
 * 事务内部的语句走 rawTx 直接发出，不重新排队，避免死锁。
 */
import type { SqlDriver, SqlParam, SqlRow } from './database';

/** 与 Rust 侧约定的命令签名 */
export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriDriverOptions {
  selectCommand?: string;
  executeCommand?: string;
}

export class TauriSqlDriver implements SqlDriver {
  private readonly selectCommand: string;
  private readonly executeCommand: string;
  /** 全量串行队列：同一时刻只有一条语句（或一个事务）在跑 */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly invoke: TauriInvoke,
    options: TauriDriverOptions = {}
  ) {
    this.selectCommand = options.selectCommand ?? 'db_select';
    this.executeCommand = options.executeCommand ?? 'db_execute';
  }

  /** 入队并串行执行；前一个失败不影响后续（只关心顺序，不关心成败） */
  private queue<T>(op: () => Promise<T>): Promise<T> {
    const queued = this.pending.then(op, op);
    this.pending = queued.catch(() => undefined);
    return queued;
  }

  select(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    return this.queue(() =>
      this.invoke<SqlRow[]>(this.selectCommand, { sql, params })
    );
  }

  execute(sql: string, params: SqlParam[] = []): Promise<number> {
    return this.queue(() =>
      this.invoke<number>(this.executeCommand, { sql, params })
    );
  }

  /**
   * 事务：BEGIN → work → COMMIT 作为队列里的一个整体，其它语句排在它前后，
   * 不会插进事务中间。失败回滚。ROLLBACK 本身再失败只能吞掉，否则会盖掉真正的业务错误。
   * 嵌套事务：SQLite 单连接不支持，rawTx.transaction 直接在当前事务里跑内层 work。
   */
  transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    const rawTx: SqlDriver = {
      select: (sql, params = []) =>
        this.invoke<SqlRow[]>(this.selectCommand, { sql, params }),
      execute: (sql, params = []) =>
        this.invoke<number>(this.executeCommand, { sql, params }),
      transaction: (inner) => inner(rawTx),
    };

    const run = async (): Promise<T> => {
      await this.invoke(this.executeCommand, { sql: 'BEGIN', params: [] });
      try {
        const result = await work(rawTx);
        await this.invoke(this.executeCommand, { sql: 'COMMIT', params: [] });
        return result;
      } catch (error) {
        await this.invoke(this.executeCommand, { sql: 'ROLLBACK', params: [] }).catch(
          () => undefined
        );
        throw error;
      }
    };

    return this.queue(run);
  }
}
