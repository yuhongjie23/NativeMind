//! 向量库
//!
//! 只负责把 sqlite-vec 扩展加载进连接。向量的读写 SQL 由前端
//! SqliteVecProvider 发出，走 db_select / db_execute 这条通道，
//! 不在这里再实现一遍 upsert / query。

pub mod sqlite_vec;
