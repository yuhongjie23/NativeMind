//! Tauri 命令
//!
//! 前端唯一的入口。分五组：
//!   db     SQL 通道，前端 TauriSqlDriver 直连
//!   file   文件 IO，前端 FileImportService 的宿主实现
//!   model  Ollama 代理
//!   vector sqlite-vec 可用性探测
//!   audio  音频资源扫描（播放仍在前端）
//!
//! 命令一律返回 Result<_, CommandError>，错误会序列化成一句中文，
//! 前端 describeError 直接拿来显示。

pub mod audio;
pub mod db;
pub mod file;
pub mod model;
pub mod search;
pub mod vector;
pub mod window;

pub use file::AppPaths;
