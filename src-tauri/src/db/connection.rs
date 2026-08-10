//! SQLite 连接与值映射
//!
//! 连接用 Mutex 包一个单例。SQLite 单连接串行执行，正好匹配前端
//! TauriSqlDriver 的事务队列：它保证同一时刻只有一个 BEGIN，
//! 这里保证同一时刻只有一个语句在跑。两边合起来事务才是安全的。
//!
//! 如果换成连接池，BEGIN 和后续语句可能落到不同连接上，事务会直接失效。
//! 这是刻意的取舍，不要改成 pool。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{ToSqlOutput, Value as SqlValue, ValueRef};
use rusqlite::{Connection, ToSql};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};

use crate::utils::{CommandError, CommandResult};

/// 前端 SqlParam 的对应类型：只允许标量
///
/// 与 TS 侧 `SqlParam = string | number | null` 一一对应。
/// 复杂结构由 Repository 序列化成 TEXT 后再传过来，这里不需要处理对象。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum SqlParam {
    Null,
    Bool(bool),
    Integer(i64),
    Real(f64),
    Text(String),
}

impl ToSql for SqlParam {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let value = match self {
            SqlParam::Null => SqlValue::Null,
            // JS 没有真布尔列，SQLite 也没有，统一存 0/1
            SqlParam::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
            SqlParam::Integer(number) => SqlValue::Integer(*number),
            SqlParam::Real(number) => SqlValue::Real(*number),
            SqlParam::Text(text) => SqlValue::Text(text.clone()),
        };
        Ok(ToSqlOutput::Owned(value))
    }
}

/// 一行结果。列名保持 snake_case，映射成领域对象是 Repository 的事
pub type SqlRow = Map<String, JsonValue>;

/// 把 SQLite 的值转成 JSON
///
/// BLOB 不转成数组：目前没有二进制列，真出现了也不该悄悄变成一个巨大的数字数组
/// 塞过 IPC，直接报错更容易发现问题。
fn value_to_json(value: ValueRef<'_>) -> CommandResult<JsonValue> {
    Ok(match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(number) => JsonValue::from(number),
        ValueRef::Real(number) => serde_json::Number::from_f64(number)
            .map(JsonValue::Number)
            // NaN / Infinity 无法表示成 JSON，退成 null 而不是让整次查询失败
            .unwrap_or(JsonValue::Null),
        ValueRef::Text(bytes) => JsonValue::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(_) => {
            return Err(CommandError::new("查询结果包含 BLOB 列，暂不支持"));
        }
    })
}

pub struct DbConnection {
    connection: Mutex<Connection>,
    path: Mutex<PathBuf>,
}

impl DbConnection {
    /// 打开数据库并设好 PRAGMA
    ///
    /// WAL：读写不互相阻塞。后台索引任务在写 note_chunks 的同时，
    /// 界面还要查 todo 列表，用默认的 journal 模式会互相卡住。
    ///
    /// foreign_keys：SQLite 默认关闭外键约束，必须每个连接显式打开，
    /// 否则 001_init.sql 里的 REFERENCES 全是装饰。
    pub fn open(path: impl AsRef<Path>) -> CommandResult<Self> {
        let path = path.as_ref().to_path_buf();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(&path)?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;",
        )?;

        Ok(Self {
            connection: Mutex::new(connection),
            path: Mutex::new(path),
        })
    }

    pub fn path(&self) -> PathBuf {
        self.path
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// 热切换到另一个数据库文件（存储地址热替换用）。
    ///
    /// 前端事务是「BEGIN…COMMIT」跨多条 IPC 完成的，连接 Mutex 只护单条语句，
    /// 所以在事务中途本可以切走。这里先等正在进行的 SQLite 事务结束（最多约 1s），
    /// 仍没结束就报错而不是硬切 —— 否则会半组数据落库或整组回滚。
    pub fn reopen(&self, path: impl AsRef<Path>) -> CommandResult<()> {
        // 等前端正在进行的事务（BEGIN 后 autocommit 关闭）结束
        for _ in 0..50 {
            let in_transaction = self
                .with(|connection| Ok(!connection.is_autocommit()))?;
            if !in_transaction {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        // 先建好新连接（不占锁），再持锁「校验无事务 + 原子替换」一步完成：
        // 否则校验后、换连接前的窗口里有 BEGIN 落到将被丢弃的旧连接上，
        // 前端后续 COMMIT 打到新连接 → 静默丢数据。
        let new_path = path.as_ref().to_path_buf();
        if let Some(parent) = new_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let new_connection = Connection::open(&new_path)?;
        new_connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;",
        )?;

        let mut guard = self
            .connection
            .lock()
            .map_err(|_| CommandError::new("数据库连接状态异常，请重启应用"))?;
        if !guard.is_autocommit() {
            return Err(CommandError::new(
                "有事务正在进行，请稍后再切换存储地址",
            ));
        }
        *guard = new_connection;
        *self
            .path
            .lock()
            .map_err(|_| CommandError::new("数据库连接状态异常，请重启应用"))? = new_path;
        Ok(())
    }

    /// 拿连接锁
    ///
    /// 锁只会在持有它的线程 panic 时被污染。那种情况下数据库状态已经不可信，
    /// 与其继续用一个可能处于半个事务中的连接，不如明确报错。
    pub fn with<T>(&self, work: impl FnOnce(&Connection) -> CommandResult<T>) -> CommandResult<T> {
        let guard = self
            .connection
            .lock()
            .map_err(|_| CommandError::new("数据库连接状态异常，请重启应用"))?;
        work(&guard)
    }

    pub fn select(&self, sql: &str, params: &[SqlParam]) -> CommandResult<Vec<SqlRow>> {
        self.with(|connection| {
            let mut statement = connection.prepare(sql)?;
            let column_names: Vec<String> = statement
                .column_names()
                .into_iter()
                .map(String::from)
                .collect();

            let mut rows = statement.query(rusqlite::params_from_iter(params))?;
            let mut result = Vec::new();

            while let Some(row) = rows.next()? {
                let mut record = SqlRow::new();
                for (index, name) in column_names.iter().enumerate() {
                    record.insert(name.clone(), value_to_json(row.get_ref(index)?)?);
                }
                result.push(record);
            }

            Ok(result)
        })
    }

    /// 执行写入，返回受影响行数
    ///
    /// 无参数时走 execute_batch：`BEGIN` / `COMMIT` / DDL 用 execute 会被
    /// rusqlite 当成异常情况处理，而这些语句恰好都是前端事务队列的必经之路。
    /// 受影响行数改由 changes() 取。
    pub fn execute(&self, sql: &str, params: &[SqlParam]) -> CommandResult<usize> {
        self.with(|connection| {
            if params.is_empty() {
                connection.execute_batch(sql)?;
                return Ok(connection.changes() as usize);
            }
            Ok(connection.execute(sql, rusqlite::params_from_iter(params))?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reopen_switches_to_new_file_and_preserves_data() {
        let root = std::env::temp_dir().join("nativemind_reopen_test");
        std::fs::remove_dir_all(&root).ok();
        let a = root.join("a.db");
        let b = root.join("b.db");

        let db = DbConnection::open(&a).unwrap();
        db.execute("CREATE TABLE t (v TEXT)", &[]).unwrap();
        db.execute("INSERT INTO t (v) VALUES ('from-a')", &[]).unwrap();

        // 热切到 b，数据独立
        db.reopen(&b).unwrap();
        db.execute("CREATE TABLE t (v TEXT)", &[]).unwrap();
        db.execute("INSERT INTO t (v) VALUES ('from-b')", &[]).unwrap();
        assert_eq!(db.path(), b);

        // 切回 a，a 的数据还在
        db.reopen(&a).unwrap();
        let rows = db.select("SELECT v FROM t", &[]).unwrap();
        assert_eq!(rows[0]["v"].as_str().unwrap(), "from-a");

        std::fs::remove_dir_all(&root).ok();
    }
}
