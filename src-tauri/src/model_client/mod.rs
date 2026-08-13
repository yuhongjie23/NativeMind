//! 模型客户端
//!
//! 目前只有 Ollama。llama.cpp 走的也是 HTTP，将来加一个同构模块即可，
//! 命令层通过枚举分派，业务不绑定具体运行时（C7）。

pub mod ollama;

pub use ollama::{CompletionRequest, InstalledModel, OllamaClient, StreamEvent};
