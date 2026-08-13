//! 文件解析
//!
//! 分工：Rust 只做 IO 和二进制解码，文本清洗与结构推断留在 TS。
//! 理由见各子模块的说明 —— 核心是不让同一份解析逻辑存在两处。

pub mod ebook;
pub mod markdown;
pub mod pdf;
