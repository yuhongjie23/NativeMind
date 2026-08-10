/**
 * 迁移幂等性与并发安全
 *
 * 回归背景：StrictMode 双次挂载会让 startRuntime() 并发跑两次，
 * 两个 migrate() 同时读到空的 schema_migrations，于是都去执行 001_init，
 * 后到的那个撞上 "table todos already exists"，把一次其实成功的初始化
 * 报成「启动失败」。
 *
 * 这里不复用 MemoryDriver：它只记录调用、按 stub 返回行，不保存写入结果，
 * 因此看不出「重复建表」这类状态冲突。下面的 FakeSqliteDriver 保留了
 * 复现这个 bug 所必需的两个行为：
 *   1. 重复 CREATE TABLE 会抛错（和真 SQLite 一致）
 *   2. 事务串行执行（和 TauriSqlDriver 的排队锁一致）
 */
import { describe, expect, it } from 'vitest';

import {
  Database,
  splitStatements,
  type SqlDriver,
  type SqlParam,
  type SqlRow,
} from '@infrastructure/db/database';
import type { Migration } from '@infrastructure/db/migrations';

class FakeSqliteDriver implements SqlDriver {
  private readonly tables = new Set<string>();
  private readonly migrationRows: SqlRow[] = [];
  /** 事务排队锁，对齐 TauriSqlDriver 的行为 */
  private pending: Promise<unknown> = Promise.resolve();
  /** 建表次数，用来断言「没有被执行两次」 */
  readonly createdTables: string[] = [];

  async select(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    if (sql.includes('FROM schema_migrations')) {
      // 版本号过滤：migrate() 在事务内会带 WHERE version = ?
      if (params.length > 0) {
        return this.migrationRows.filter((row) => row.version === params[0]);
      }
      return [...this.migrationRows].sort((a, b) => Number(a.version) - Number(b.version));
    }
    return [];
  }

  async execute(sql: string, params: SqlParam[] = []): Promise<number> {
    const statement = sql.trim();

    if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(statement)) return 0;

    const created = /^CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i.exec(statement);
    if (created) {
      const table = created[1];
      const ifNotExists = /IF NOT EXISTS/i.test(statement);
      if (this.tables.has(table)) {
        if (ifNotExists) return 0;
        // 真 SQLite 在这里报的就是这句话
        throw new Error(`table ${table} already exists`);
      }
      this.tables.add(table);
      this.createdTables.push(table);
      return 0;
    }

    if (statement.startsWith('INSERT INTO schema_migrations')) {
      const [version, name, appliedAt] = params;
      this.migrationRows.push({ version, name, applied_at: appliedAt });
      return 1;
    }

    return 0;
  }

  /** 串行执行，保证同一时刻只有一个事务在跑 */
  transaction<T>(work: (tx: SqlDriver) => Promise<T>): Promise<T> {
    const run = () => work(this);
    const queued = this.pending.then(run, run);
    this.pending = queued.catch(() => undefined);
    return queued;
  }
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
  },
  {
    version: 2,
    name: 'add_notes',
    sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY)',
  },
];

describe('Database.migrate', () => {
  it('首次运行会执行全部迁移', async () => {
    const db = new Database(new FakeSqliteDriver(), MIGRATIONS);

    const executed = await db.migrate();

    expect(executed.map((record) => record.version)).toEqual([1, 2]);
  });

  it('重复调用不会重跑已应用的迁移', async () => {
    const driver = new FakeSqliteDriver();
    const db = new Database(driver, MIGRATIONS);
    await db.migrate();

    const second = await db.migrate();

    expect(second).toEqual([]);
    expect(driver.createdTables).toEqual(['schema_migrations', 'todos', 'notes']);
  });

  it('并发调用时每个迁移只执行一次', async () => {
    const driver = new FakeSqliteDriver();
    const db = new Database(driver, MIGRATIONS);

    // 两个 migrate() 同时进来，模拟 StrictMode 的双次挂载。
    // 修复前这里会抛 "table todos already exists"
    const [first, second] = await Promise.all([db.migrate(), db.migrate()]);

    // 两次调用加起来正好覆盖两个版本，没有任何一个被执行两次
    const versions = [...first, ...second].map((record) => record.version).sort();
    expect(versions).toEqual([1, 2]);

    expect(driver.createdTables).toEqual(['schema_migrations', 'todos', 'notes']);
    expect((await db.listMigrations()).map((record) => record.version)).toEqual([1, 2]);
  });

  it('按版本号升序执行，与注册顺序无关', async () => {
    const driver = new FakeSqliteDriver();
    const db = new Database(driver, [...MIGRATIONS].reverse());

    const executed = await db.migrate();

    expect(executed.map((record) => record.version)).toEqual([1, 2]);
    expect(driver.createdTables).toEqual(['schema_migrations', 'todos', 'notes']);
  });

  it('表被库外提前创建（schema_migrations 无记录）→ 跳过并记为已应用，不报启动失败', async () => {
    const driver = new FakeSqliteDriver();
    // 模拟 letters 表被直接建出来、但迁移记录缺失 —— 这正是用户遇到的「duplicate column」场景的同类问题
    await driver.execute('CREATE TABLE todos (id TEXT PRIMARY KEY)');

    const db = new Database(driver, MIGRATIONS);
    const executed = await db.migrate();

    expect(executed.map((record) => record.version)).toEqual([1, 2]);
  });
});

/** 模拟「列已存在但迁移未记录」：ALTER ADD COLUMN 撞 duplicate column name */
class DuplicateColumnDriver extends FakeSqliteDriver {
  async execute(sql: string, params: SqlParam[] = []): Promise<number> {
    if (/ADD COLUMN direction/i.test(sql)) throw new Error('duplicate column name: direction');
    return super.execute(sql, params);
  }
}

describe('Database.migrate 自愈（列已存在）', () => {
  it('ALTER 加已存在的列 → 跳过该语句并记为已应用', async () => {
    const driver = new DuplicateColumnDriver();
    const migrations: Migration[] = [
      { version: 1, name: 'init', sql: 'CREATE TABLE letters (id TEXT PRIMARY KEY)' },
      { version: 2, name: 'add_direction', sql: 'ALTER TABLE letters ADD COLUMN direction TEXT' },
    ];
    const db = new Database(driver, migrations);

    const executed = await db.migrate();

    expect(executed.map((record) => record.version)).toEqual([1, 2]);
    // 14/15 已记录的既有测试继续有效；这里验证「列已存在」也能正常收尾
    expect((await db.listMigrations()).map((record) => record.version)).toEqual([1, 2]);
  });
});

describe('splitStatements', () => {
  it('按 @@split 切分并去掉纯注释块', () => {
    const sql = [
      '-- 建表',
      'CREATE TABLE a (id TEXT);',
      '-- @@split',
      'CREATE TABLE b (id TEXT);',
    ].join('\n');

    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (id TEXT)', 'CREATE TABLE b (id TEXT)']);
  });
});
