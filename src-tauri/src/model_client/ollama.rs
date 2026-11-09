//! Ollama 客户端
//!
//! 前端已有一个走 fetch 的 OllamaProvider。这层不是替代它，而是给
//! 「需要绕开 WebView 网络限制」和「长时任务不占前端连接」的场景准备的通道，
//! 两者共用同一套 /api 契约。
//!
//! C6：只允许连本机。这条不能只靠前端把关 —— 前端的 assertLocalUrl 是在
//! 渲染进程里做的，改一行 JS 就绕过了。Rust 侧必须独立再验一次。

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::utils::{CommandError, CommandResult};

const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1", "0.0.0.0"];
const DEFAULT_BASE_URL: &str = "http://localhost:11434";

/// 校验并规范化 base url
///
/// 手写解析而不引 url crate：只需要取出 host 段，为这点需求多拉一个依赖不值得。
fn assert_local(base_url: &str) -> CommandResult<String> {
    let trimmed = base_url.trim_end_matches('/');

    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .ok_or_else(|| CommandError::new("模型地址必须以 http:// 开头"))?;

    // 去掉路径和认证信息。`user@host` 这种写法能骗过朴素的前缀匹配，必须先剥掉
    let authority = without_scheme.split('/').next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or(authority);

    // IPv6 字面量形如 [::1]:11434
    let host = if let Some(rest) = host_port.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host_port.split(':').next().unwrap_or("")
    };

    if !LOCAL_HOSTS.contains(&host) {
        return Err(CommandError::new(format!(
            "模型运行时只允许连本机，收到 {host}"
        )));
    }

    Ok(trimmed.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub system: Option<String>,
    /// 要求模型直出 JSON，显著降低 Schema 校验失败率（C5）
    #[serde(default)]
    pub json: bool,
    /// 目标结构的 JSON Schema，用于约束解码。
    ///
    /// 只说 format=json 只能保证「是合法 JSON」，不保证结构：实测本地小模型
    /// 会把要求的数组输出成单个对象，事后校验必然失败。把 schema 传给 Ollama
    /// 后，非法 token 在采样阶段就被排除。
    #[serde(default)]
    pub json_schema: Option<serde_json::Value>,

    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub base_url: Option<String>,
    /// 本地 7B 出一段复盘可能要几十秒，默认给足
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub parameter_size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<TagEntry>,
}

#[derive(Debug, Deserialize)]
struct TagEntry {
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    details: Option<TagDetails>,
}

#[derive(Debug, Deserialize)]
struct TagDetails {
    #[serde(default)]
    parameter_size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    response: Option<String>,
}

/// 流式生成事件：一段文本增量 + 结束标记。由 Tauri Channel 推给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub delta: String,
    pub done: bool,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    #[serde(default)]
    embedding: Option<Vec<f32>>,
}

pub struct OllamaClient {
    http: reqwest::Client,
    base_url: String,
}

impl OllamaClient {
    pub fn new(base_url: Option<&str>) -> CommandResult<Self> {
        let base_url = assert_local(base_url.unwrap_or(DEFAULT_BASE_URL))?;
        Ok(Self {
            // A loopback URL must never leak through a configured proxy or redirect.
            http: reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build()?,
            base_url,
        })
    }

    /// 服务是否就绪
    ///
    /// 不返回 Result：ModelRouter 的降级链靠布尔值判断「这一层能不能用」，
    /// 抛错会打断整条链。超时给 3 秒，探活不该让用户等。
    pub async fn is_ready(&self) -> bool {
        let outcome = self
            .http
            .get(format!("{}/api/tags", self.base_url))
            .timeout(Duration::from_secs(3))
            .send()
            .await;

        matches!(outcome, Ok(response) if response.status().is_success())
    }

    /// 运行时探测保留空表降级语义；设置诊断使用 checked 版本区分失败。
    pub async fn list_models(&self) -> Vec<InstalledModel> {
        self.list_models_checked().await.unwrap_or_default()
    }

    pub async fn list_models_checked(&self) -> CommandResult<Vec<InstalledModel>> {
        let response = self
            .http
            .get(format!("{}/api/tags", self.base_url))
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| CommandError::new("无法连接本机 Ollama，请确认服务已启动"))?
            .error_for_status()
            .map_err(|_| CommandError::new("Ollama 模型列表请求失败，请检查本机服务"))?;
        let payload = response.json::<TagsResponse>().await
            .map_err(|_| CommandError::new("Ollama 返回了无效的模型列表，请更新或重启服务"))?;

        Ok(payload
            .models
            .into_iter()
            .map(|entry| InstalledModel {
                name: entry.name,
                size_bytes: entry.size,
                parameter_size: entry.details.and_then(|details| details.parameter_size),
            })
            .collect())
    }

    pub async fn complete(&self, request: CompletionRequest) -> CommandResult<String> {
        // 每次调用允许覆盖 base_url，但覆盖值同样要过本机校验
        let base_url = match request.base_url.as_deref() {
            Some(url) => assert_local(url)?,
            None => self.base_url.clone(),
        };

        let mut options = serde_json::Map::new();
        options.insert(
            "temperature".to_string(),
            serde_json::json!(request.temperature.unwrap_or(0.2)),
        );
        if let Some(max_tokens) = request.max_tokens {
            options.insert("num_predict".to_string(), serde_json::json!(max_tokens));
        }

        let mut body = serde_json::json!({
            "model": request.model,
            "prompt": request.prompt,
            "stream": false,
            "options": options,
        });
        // Qwen3 默认思考可能耗尽短任务的输出额度，只返回空 response。
        // NativeMind 消费最终答案；通过 API 关闭思考，比提示词 /no_think 可靠。
        if request.model == "qwen3" || request.model.starts_with("qwen3:") {
            body["think"] = serde_json::json!(false);
        }

        if let Some(system) = request.system {
            body["system"] = serde_json::json!(system);
        }
        // 有 schema 就传 schema（约束解码），否则退回 "json"（仅保证合法 JSON）
        if request.json {
            body["format"] = match request.json_schema {
                Some(schema) => schema,
                None => serde_json::json!("json"),
            };
        }


        let response = self
            .http
            .post(format!("{base_url}/api/generate"))
            .timeout(Duration::from_millis(request.timeout_ms.unwrap_or(120_000)))
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(CommandError::new(format!(
                "Ollama /api/generate 返回 {}",
                response.status()
            )));
        }

        Ok(response
            .json::<GenerateResponse>()
            .await?
            .response
            .unwrap_or_default())
    }

    /// 流式生成：/api/generate 带 stream:true 后返回 NDJSON，逐行解析增量，
    /// 通过 on_token 回调送出；返回拼好的全文。
    ///
    /// 与 complete() 唯一的差别是 stream:true + 边收边回调，请求体构造一致。
    pub async fn complete_stream<F>(&self, request: CompletionRequest, mut on_token: F) -> CommandResult<String>
    where
        F: FnMut(StreamEvent),
    {
        let base_url = match request.base_url.as_deref() {
            Some(url) => assert_local(url)?,
            None => self.base_url.clone(),
        };

        let mut options = serde_json::Map::new();
        options.insert(
            "temperature".to_string(),
            serde_json::json!(request.temperature.unwrap_or(0.2)),
        );
        if let Some(max_tokens) = request.max_tokens {
            options.insert("num_predict".to_string(), serde_json::json!(max_tokens));
        }

        let mut body = serde_json::json!({
            "model": request.model,
            "prompt": request.prompt,
            "stream": true,
            "options": options,
        });
        if request.model == "qwen3" || request.model.starts_with("qwen3:") {
            body["think"] = serde_json::json!(false);
        }
        if let Some(system) = request.system {
            body["system"] = serde_json::json!(system);
        }
        if request.json {
            body["format"] = match request.json_schema {
                Some(schema) => schema,
                None => serde_json::json!("json"),
            };
        }

        let mut response = self
            .http
            .post(format!("{base_url}/api/generate"))
            .timeout(Duration::from_millis(request.timeout_ms.unwrap_or(120_000)))
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(CommandError::new(format!(
                "Ollama /api/generate 返回 {}",
                response.status()
            )));
        }

        // NDJSON 按行切；跨 chunk 的残行用「字节」buffer 接着，整行才解码——
        // 逐块 from_utf8_lossy 会把跨块边界的多字节 UTF-8 字符拆成 � + 乱字节，
        // 中文流式输出几乎必现。整行解码后 JSON 行也能稳定解析。
        let mut full = String::new();
        let mut pending: Vec<u8> = Vec::new();
        let mut done = false;
        let mut consume = |line: &[u8]| -> CommandResult<bool> {
            if line.iter().all(u8::is_ascii_whitespace) { return Ok(false); }
            let chunk: GenerateResponse = serde_json::from_slice(line)?;
            if let Some(error) = chunk.error { return Err(CommandError::new(error)); }
            if let Some(delta) = chunk.response {
                if full.len() + delta.len() > 4 * 1024 * 1024 {
                    return Err(CommandError::new("模型输出过长"));
                }
                if !delta.is_empty() {
                    full.push_str(&delta);
                    on_token(StreamEvent { delta, done: false });
                }
            }
            Ok(chunk.done)
        };
        'stream: while let Some(bytes) = response.chunk().await? {
            if pending.len() + bytes.len() > 4 * 1024 * 1024 {
                return Err(CommandError::new("模型流数据过大"));
            }
            pending.extend_from_slice(&bytes);
            while let Some(pos) = pending.iter().position(|&b| b == b'\n') {
                done = consume(&pending[..pos])?;
                pending.drain(..=pos);
                if done { break 'stream; }
            }
        }
        if !done && !pending.is_empty() { done = consume(&pending)?; }
        if !done { return Err(CommandError::new("模型输出中断，请重新生成")); }
        on_token(StreamEvent {
            delta: String::new(),
            done: true,
        });
        Ok(full)
    }

    /// 批量 embedding
    ///
    /// 串行发送：Ollama 的 /api/embeddings 一次只收一段文本，
    /// 并发会把本地显存打满，反而更慢。
    pub async fn embed(&self, model: &str, texts: &[String]) -> CommandResult<Vec<Vec<f32>>> {
        let mut vectors = Vec::with_capacity(texts.len());

        for text in texts {
            let response = self
                .http
                .post(format!("{}/api/embeddings", self.base_url))
                .timeout(Duration::from_secs(60))
                .json(&serde_json::json!({ "model": model, "prompt": text }))
                .send()
                .await?;

            if !response.status().is_success() {
                return Err(CommandError::new(format!(
                    "Ollama /api/embeddings 返回 {}",
                    response.status()
                )));
            }

            vectors.push(
                response
                    .json::<EmbeddingResponse>()
                    .await?
                    .embedding
                    .unwrap_or_default(),
            );
        }

        Ok(vectors)
    }
}

#[cfg(test)]
mod tests {
    use super::assert_local;

    #[test]
    fn loopback_model_cannot_redirect_a_prompt() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let destination = TcpListener::bind("127.0.0.1:0").unwrap();
        destination.set_nonblocking(true).unwrap();
        let location = format!("http://{}/collect", destination.local_addr().unwrap());
        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        let client = super::OllamaClient::new(Some(&format!("http://{}", source.local_addr().unwrap()))).unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = source.accept().unwrap();
            socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut buffer = [0; 2048];
            socket.read(&mut buffer).unwrap();
            write!(socket, "HTTP/1.1 307 Temporary Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let response = runtime.block_on(client.http.post(format!("{}/api/generate", client.base_url)).body("PRIVATE_TEST_PROMPT").send()).unwrap();
        assert_eq!(response.status().as_u16(), 307);
        server.join().unwrap();
        assert_eq!(destination.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    }

    #[test]
    fn checked_inventory_distinguishes_empty_invalid_and_failed_responses() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        for (status, payload, count) in [
            ("200 OK", r#"{"models":[]}"#, Some(0)),
            ("200 OK", r#"{"models":[{"name":"qwen3:14b","size":42}]}"#, Some(1)),
            ("503 Unavailable", r#"{"models":[]}"#, None),
            ("200 OK", "invalid JSON", None),
            ("200 OK", r#"{"error":"not a model list"}"#, None),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let client = super::OllamaClient::new(Some(&format!("http://{}", listener.local_addr().unwrap()))).unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let n = socket.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&buffer[..n]);
                }
                assert!(String::from_utf8_lossy(&request).starts_with("GET /api/tags "));
                write!(socket, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len()).unwrap();
            });
            let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            let outcome = runtime.block_on(client.list_models_checked());
            match count {
                Some(expected) => assert_eq!(outcome.unwrap().len(), expected),
                None => assert!(outcome.is_err()),
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn qwen3_short_generations_disable_thinking_in_both_paths() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        for streaming in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base_url = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0u8; 4096];
                let body = loop {
                    let count = socket.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length: usize = headers.lines().find_map(|line| {
                            let (key, value) = line.split_once(':')?;
                            key.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
                        }).unwrap();
                        if bytes.len() >= end + 4 + length {
                            break serde_json::from_slice::<serde_json::Value>(&bytes[end + 4..end + 4 + length]).unwrap();
                        }
                    }
                };
                let answer = if body["think"] == false { "模型连接正常" } else { "" };
                let payload = format!("{}\n", serde_json::json!({"response":answer,"done":true}));
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", payload.len(), payload).unwrap();
                body
            });
            let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            let request = serde_json::from_value(serde_json::json!({
                "model":"qwen3:14b", "prompt":"只回复模型连接正常", "max_tokens":32, "base_url":base_url
            })).unwrap();
            let client = super::OllamaClient::new(None).unwrap();
            let mut deltas = String::new();
            let result = runtime.block_on(async {
                if streaming {
                    client.complete_stream(request, |event| deltas.push_str(&event.delta)).await
                } else {
                    client.complete(request).await
                }
            }).unwrap();
            assert_eq!(result, "模型连接正常");
            if streaming { assert_eq!(deltas, result); }
            let body = server.join().unwrap();
            assert_eq!(body["stream"], streaming);
            assert_eq!(body["options"]["num_predict"], 32);
        }
    }

    #[test]
    fn accepts_local_hosts() {
        assert!(assert_local("http://localhost:11434").is_ok());
        assert!(assert_local("http://127.0.0.1:11434/").is_ok());
        assert!(assert_local("http://[::1]:11434").is_ok());
    }

    #[test]
    fn rejects_remote_hosts() {
        assert!(assert_local("http://evil.example.com").is_err());
        // 认证信息前缀不能骗过校验
        assert!(assert_local("http://localhost@evil.example.com").is_err());
        // 路径里带 localhost 也不行
        assert!(assert_local("http://evil.example.com/localhost").is_err());
        assert!(assert_local("ftp://localhost").is_err());
    }

    #[test]
    fn strips_trailing_slash() {
        assert_eq!(
            assert_local("http://localhost:11434/").unwrap(),
            "http://localhost:11434"
        );
    }
}
