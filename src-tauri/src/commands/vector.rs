//! 向量能力命令
//!
//! 前端 `SqliteVecProvider.isAvailable()` 需要知道 vec0 扩展到底加载上了没有。
//! 拿不到这个答案，RAG 就无法在缺组件时降级到关键词检索（C3）。
//!
//! 每次调用重新探测而不是缓存启动结果：用户可能在设置页看到「不可用」后
//! 把扩展文件放进 extensions 目录，此时不该要求重启应用才生效。

use tauri::State;

use crate::commands::file::AppPaths;
use crate::db::DbConnection;
use crate::utils::CommandResult;
use crate::vector::sqlite_vec;

/// 重新探测 sqlite-vec 可用性
#[tauri::command]
pub fn vector_status(
    db: State<'_, DbConnection>,
    paths: State<'_, AppPaths>,
) -> CommandResult<sqlite_vec::VectorStatus> {
    Ok(sqlite_vec::load(&db, &paths.extension_dir))
}

/// 扩展文件应该放在哪。设置页要把这个路径显示给用户
#[tauri::command]
pub fn vector_extension_dir(paths: State<'_, AppPaths>) -> String {
    paths.extension_dir.display().to_string()
}
