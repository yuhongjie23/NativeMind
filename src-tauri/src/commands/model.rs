//! 模型命令
//!
//! 对应前端 `ModelRuntime` 与 `EmbeddingProvider` 的能力。
//!
//! is_ready / list_models 刻意不返回错误：ModelRouter 的降级链
//! （§16.1）靠这两个结果判断某一层能不能用，抛错会打断整条链，
//! 让「模型没装」这种正常情况变成崩溃。

use tauri::ipc::Channel;
use tauri::State;

use crate::model_client::{CompletionRequest, InstalledModel, OllamaClient, StreamEvent};
use crate::utils::CommandResult;

/// 模型运行时是否就绪
#[tauri::command]
pub async fn model_is_ready(client: State<'_, OllamaClient>) -> Result<bool, ()> {
    Ok(client.is_ready().await)
}

/// 确保本机 Ollama 服务在运行：未运行则无窗口后台拉起 `ollama serve`，最多等 ~10 秒。
///
/// 返回 "already_running"（本来就在跑）/ "started"（这次拉起来了）/
/// "failed"（拉起了但没就绪，或没有 ollama 可执行文件）。不抛错，
/// 前端据此给用户提示，不打断启动流程。
#[tauri::command]
pub async fn ollama_ensure_running(client: State<'_, OllamaClient>) -> Result<String, String> {
    if client.is_ready().await {
        return Ok("already_running".to_string());
    }

    if let Err(error) = try_start_ollama() {
        return Err(format!("无法启动 Ollama：{error}"));
    }

    for _ in 0..10 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if client.is_ready().await {
            return Ok("started".to_string());
        }
    }
    Ok("failed".to_string())
}

/// 无窗口后台拉起 `ollama serve`。Windows 上带 CREATE_NO_WINDOW，不弹黑框；
/// 三路 stdio 全部丢弃，避免子进程日志刷进应用 stdout / 阻塞在继承的控制台上。
fn try_start_ollama() -> std::io::Result<()> {
    let mut command = std::process::Command::new("ollama");
    command
        .arg("serve")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _child = command.spawn()?;
    Ok(())
}

/// 已安装模型列表。探测失败返回空表
#[tauri::command]
pub async fn model_list(client: State<'_, OllamaClient>) -> Result<Vec<InstalledModel>, ()> {
    Ok(client.list_models().await)
}

/// 某个模型是否可用
///
/// 比对忽略 `:latest` 后缀：tier-config 里写 `qwen2.5:7b`，
/// 而 Ollama 可能报成 `qwen2.5:7b-instruct-q4_0`，直接相等比较会全部落空。
/// 这个规则必须和前端 OllamaProvider.isAvailable 保持一致。
#[tauri::command]
pub async fn model_is_available(
    client: State<'_, OllamaClient>,
    model: String,
) -> Result<bool, ()> {
    let installed = client.list_models().await;
    if installed.is_empty() {
        return Ok(false);
    }

    let target = model.trim_end_matches(":latest");

    Ok(installed.iter().any(|entry| {
        entry.name == model
            || entry.name.trim_end_matches(":latest") == target
            || entry.name.starts_with(&format!("{target}-"))
    }))
}

/// 文本生成
#[tauri::command]
pub async fn model_complete(
    client: State<'_, OllamaClient>,
    request: CompletionRequest,
) -> CommandResult<String> {
    client.complete(request).await
}

/// 流式文本生成
///
/// 增量通过 Channel 实时推给前端（onToken 预览），命令本身等流结束
/// 返回完整文本 —— 前端以返回值做权威，Channel 增量只是渐进预览。
/// rename_all 显式 snake_case：Channel 参数名 on_token 直接对上前端传参，
/// 避免 Tauri 默认的 camelCase 转换造成键名对不上。
#[tauri::command(rename_all = "snake_case")]
pub async fn model_complete_stream(
    client: State<'_, OllamaClient>,
    request: CompletionRequest,
    on_token: Channel<StreamEvent>,
) -> CommandResult<String> {
    client
        .complete_stream(request, |event| {
            let _ = on_token.send(event);
        })
        .await
}

/// 批量向量化
#[tauri::command]
pub async fn model_embed(
    client: State<'_, OllamaClient>,
    model: String,
    texts: Vec<String>,
) -> CommandResult<Vec<Vec<f32>>> {
    client.embed(&model, &texts).await
}
