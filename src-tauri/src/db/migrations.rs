//! 迁移状态查询
//!
//! **迁移 SQL 不在 Rust 侧。** 唯一来源是 TS 的
//! `src/infrastructure/db/migrations/*.sql`，由 `Database.migrate()` 驱动执行。
//!
//! 原因：前端已经实现了完整的版本表 + 逐个事务 + 断点续跑逻辑，
//! Rust 再维护一份就有了两个真相，两边版本号一旦错位，
//! 排查成本远高于它带来的任何好处。
//!
//! 这里只提供只读的状态查询，给启动自检和设置页用。

use serde::Serialize;

use super::connection::DbConnection;
use crate::utils::CommandResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaStatus {
    /// 迁移表是否存在。首次启动时为 false，前端接着跑 migrate() 即可
    pub initialized: bool,
    /// 已应用的最高版本号，未初始化时为 0
    pub current_version: i64,
    pub applied: Vec<MigrationRecord>,
}

fn table_exists(connection: &rusqlite::Connection, name: &str) -> CommandResult<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn schema_status(db: &DbConnection) -> CommandResult<SchemaStatus> {
    db.with(|connection| {
        if !table_exists(connection, "schema_migrations")? {
            return Ok(SchemaStatus {
                initialized: false,
                current_version: 0,
                applied: Vec::new(),
            });
        }

        let mut statement = connection
            .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")?;
        let rows = statement.query_map([], |row| {
            Ok(MigrationRecord {
                version: row.get(0)?,
                name: row.get(1)?,
                applied_at: row.get(2)?,
            })
        })?;

        let applied: Vec<MigrationRecord> = rows.collect::<rusqlite::Result<_>>()?;
        let current_version = applied.last().map(|record| record.version).unwrap_or(0);

        Ok(SchemaStatus {
            initialized: true,
            current_version,
            applied,
        })
    })
}

/// PRAGMA integrity_check
///
/// 断电或磁盘写满可能留下损坏的数据库文件。这个检查会全表扫描，
/// 不适合每次启动都跑，只在设置页由用户手动触发。
pub fn integrity_check(db: &DbConnection) -> CommandResult<String> {
    db.with(|connection| {
        let result: String =
            connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        Ok(result)
    })
}
