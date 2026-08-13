/**
 * SQLite 连接与迁移（C7：外部依赖走接口）
 *
 * 这里不直接绑定某个 SQLite 客户端。Tauri 环境下 SQL 要走 IPC 到 Rust 侧执行，
 * 测试环境需要一个纯内存实现，所以统一抽象成 SqlDriver。
 * 业务代码只认 Database，换驱动不影响 Repository。
 */
import { MIGRATIONS, type Migration } from './migrations';

/** 一行查询结果。列名保持数据库的 snake_case，由 Repository 负责映射 */
export type SqlRow = Record<string, unknown>;

/** SQL 参数只允许标量，复杂结构由 Repository 序列化成 TEXT */
export type SqlParam = string | number | null;

export interface SqlDriver {
  /** 查询多行 */
  select(sql: string, params?: SqlParam[]): Promise<SqlRow[]>;
  /** 写入，返回受影响行数 */
  execute(sql: string, params?: SqlParam[]): Promise<number>;
  /**
   * 在一个事务里跑一批语句。
   * 迁移和批量写入依赖它保证「要么全成、要么全滚」。
   */
  transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: string;
}

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

/**
 * 把迁移文件按 `-- @@split` 切成独立语句。
 * 很多 SQLite 驱动一次只接受一条语句，所以不能整个文件丢过去。
 */
export const splitStatements = (sql: string): string[] =>
  sql
    .split(/^--\s*@@split\s*$/gm)
    .map((chunk) =>
      chunk
        // 去掉整行注释，避免只剩注释的空语句
        .replace(/^\s*--.*$/gm, '')
        .trim()
    )
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.replace(/;\s*$/, ''));

export class Database {
  constructor(
    private readonly driver: SqlDriver,
    private readonly migrations: Migration[] = MIGRATIONS
  ) {}

  /**
   * 建表并补齐未执行的迁移。应用启动时调用一次，可重复调用。
   * 每个迁移单独一个事务：前面成功的不会因为后面失败被回滚，
   * 下次启动能从断点继续。
   *
   * 并发安全：版本号的判定放在事务**内部**重做一次。
   * 事务外先查一遍再执行会留下竞态窗口 —— 两个 migrate() 同时进来
   * 都读到空表，就都去跑 001_init，后到的撞 "table todos already exists"。
   * 驱动的事务队列保证同一时刻只有一个事务，因此在事务内复查是可靠的。
   */
  async migrate(): Promise<MigrationRecord[]> {
    await this.driver.execute(MIGRATION_TABLE);

    const ordered = [...this.migrations].sort((left, right) => left.version - right.version);
    const executed: MigrationRecord[] = [];

    for (const migration of ordered) {
      const record: MigrationRecord = {
        version: migration.version,
        name: migration.name,
        appliedAt: new Date().toISOString(),
      };

      const didRun = await this.driver.transaction(async (tx) => {
        const existing = await tx.select(
          'SELECT version FROM schema_migrations WHERE version = ?',
          [migration.version]
        );
        if (existing.length > 0) return false;

        for (const statement of splitStatements(migration.sql)) {
          try {
            await tx.execute(statement);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 目标已存在（表/索引/列被库外提前创建，schema_migrations 却没记录）：
            // 迁移的终态已经达到，视作已应用继续。这是刻意的恢复机制（有单测覆盖：
            // database-migrate.test.ts「表被库外提前创建→跳过并记为已应用」），
            // 收窄到仅 duplicate-column 会打破 out-of-band 建表的恢复路径。代价是
            // 同名词的已存在对象（如表）不会自动纠正定义，这属于可接受的可恢复场景。
            if (/duplicate column name|already exists/i.test(message)) continue;
            throw error;
          }
        }
        await tx.execute(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [record.version, record.name, record.appliedAt]
        );
        return true;
      });

      if (didRun) executed.push(record);
    }

    return executed;
  }


  async listMigrations(): Promise<MigrationRecord[]> {
    const rows = await this.driver.select(
      'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
    );
    return rows.map((row) => ({
      version: Number(row.version),
      name: String(row.name),
      appliedAt: String(row.applied_at),
    }));
  }

  select(sql: string, params?: SqlParam[]): Promise<SqlRow[]> {
    return this.driver.select(sql, params);
  }

  async selectOne(sql: string, params?: SqlParam[]): Promise<SqlRow | null> {
    const rows = await this.driver.select(sql, params);
    return rows[0] ?? null;
  }

  execute(sql: string, params?: SqlParam[]): Promise<number> {
    return this.driver.execute(sql, params);
  }

  transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    return this.driver.transaction(work);
  }

  async close(): Promise<void> {
    await this.driver.close?.();
  }
}

/* ---------- 列值映射工具（Repository 共用） ---------- */

/**
 * 把本地日（YYYY-MM-DD）换算成 UTC 区间的起止 ISO 字符串。
 * 库里时间戳是 UTC ISO，直接 `substr(created_at,1,10)` 取的是 UTC 日期 ——
 * 东八区凌晨建的任务会归到前一天。要按「本地日」查，必须用本地日零点的 UTC 区间。
 * 返回 [当天零点, 次日零点) 的 UTC ISO。
 */
export const localDayRangeUtc = (localDate: string): [string, string] => {
  const [year, month, day] = localDate.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).toISOString();
  return [start, end];
};

export const toJsonColumn = (value: unknown): string => JSON.stringify(value ?? null);

/** 读 JSON 列。历史脏数据或 null 都退回 fallback，不让一行坏数据搞崩整个列表 */
export const fromJsonColumn = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
};

export const toBoolColumn = (value: boolean): number => (value ? 1 : 0);
export const fromBoolColumn = (value: unknown): boolean => Number(value) === 1;

export const optionalText = (value: string | undefined | null): SqlParam => value ?? null;
export const optionalNumber = (value: number | undefined | null): SqlParam =>
  value === undefined || value === null ? null : value;

export const readText = (value: unknown): string | undefined =>
  value === null || value === undefined ? undefined : String(value);
export const readNumber = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : Number(value);
