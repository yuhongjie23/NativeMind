//! 数据库命令
//!
//! 命令名和参数名必须与前端 `TauriSqlDriver` 对齐：
//! 它默认调 `db_select` / `db_execute`，参数是 `{ sql, params }`。
//! 改这里的签名会直接让前端所有 Repository 失效。
//!
//! 关于「前端发原始 SQL」这件事：SQL 语句全部是 TS 侧写死的字面量，
//! 用户输入一律走 `?` 占位参数，不做字符串拼接。真正的注入风险在
//! Repository 里，而那边已经统一用参数化查询。

use tauri::State;

use crate::db::{DbConnection, SqlParam, SqlRow};
use crate::utils::CommandResult;

#[tauri::command]
pub fn db_select(
    db: State<'_, DbConnection>,
    sql: String,
    params: Option<Vec<SqlParam>>,
) -> CommandResult<Vec<SqlRow>> {
    db.select(&sql, &params.unwrap_or_default())
}

#[tauri::command]
pub fn db_execute(
    db: State<'_, DbConnection>,
    sql: String,
    params: Option<Vec<SqlParam>>,
) -> CommandResult<usize> {
    db.execute(&sql, &params.unwrap_or_default())
}

/// schema 状态，给启动自检和设置页用
#[tauri::command]
pub fn db_schema_status(
    db: State<'_, DbConnection>,
) -> CommandResult<crate::db::migrations::SchemaStatus> {
    crate::db::migrations::schema_status(&db)
}

/// 完整性检查。全表扫描，只在用户手动触发时调用
#[tauri::command]
pub fn db_integrity_check(db: State<'_, DbConnection>) -> CommandResult<String> {
    crate::db::migrations::integrity_check(&db)
}

/// 数据库文件路径，设置页展示「数据存在哪」
#[tauri::command]
pub fn db_path(db: State<'_, DbConnection>) -> String {
    crate::utils::display_path(&db.path())
}

/// 一致性快照与轮转策略与 Anna 共用；这里只解析桌面路径。
#[tauri::command]
pub async fn db_backup(
    db: State<'_, DbConnection>,
    paths: State<'_, crate::commands::file::AppPaths>,
) -> CommandResult<String> {
    crate::db::backup::create_snapshot(db.path(), paths.data_dir().join("backups")).await
}
