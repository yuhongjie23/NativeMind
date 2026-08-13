//! 外部搜索 HTTP 抓取
//!
//! WebView 有 CORS 限制，不能直接 fetch 搜索引擎页面。
//! 这个命令绕开浏览器网络栈，让 Rust 侧做 HTTP GET，
//! 把 HTML 原文返回给前端去解析。HTML 解析逻辑全部留在 TS 侧，
//! 方便单元测试，不用每次改解析规则都重新编译 Rust。
//!
//! 安全：这是 WebView 能触达的任意出站 HTTP 通道，必须当 SSRF 通道收紧 ——
//! 只允许访问公网搜索引擎，拒绝回环/内网/云元数据地址，限制重定向与响应大小。

use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::redirect::Policy;

use crate::utils::{CommandError, CommandResult};

/// 桌面浏览器 UA，避免被搜索引擎当作爬虫直接拦截
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/// 单次搜索抓取最长等 15 秒。搜索引擎偶尔慢，但用户不该等更久
const FETCH_TIMEOUT_SECS: u64 = 15;
/// 响应体上限 5MB：搜索引擎页面足够大，但封死被当成内存 DoS 的入口
const MAX_BODY_BYTES: u64 = 5 * 1024 * 1024;
/// 最多跟随 3 次重定向；每次重定向后仍要校验最终 host 是公网
const MAX_REDIRECTS: usize = 3;

#[derive(Debug, serde::Serialize)]
pub struct SearchFetchResponse {
    pub body: String,
    pub status: u16,
    /// 实际请求到的最终 URL（发生重定向时与请求的 url 不同）
    pub final_url: String,
}

/// 从 URL 里取出 host（不含端口；IPv6 字面量取 [] 内内容）
fn extract_host(url: &str) -> Option<&str> {
    let after_scheme = url.split_once("://")?.1;
    let host_port = after_scheme.split(['/', '?', '#']).next()?;
    if host_port.starts_with('[') {
        return host_port.find(']').map(|i| &host_port[1..i]);
    }
    Some(host_port.rsplit_once(':').map(|(host, _)| host).unwrap_or(host_port))
}

/// 回环 / 内网 / 云元数据 / 保留段一律拒绝
fn is_blocked(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || v6.is_multicast(),
    }
}

/// 校验 URL 的 host 解析后没有内网/回环/云元数据地址
async fn host_is_safe(url: &str) -> CommandResult<()> {
    let Some(host) = extract_host(url) else {
        return Err(CommandError::new("URL 缺少主机名"));
    };
    if host.eq_ignore_ascii_case("localhost") {
        return Err(CommandError::new("不允许访问本机地址"));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked(&ip) {
            return Err(CommandError::new("不允许访问内网/保留地址"));
        }
        return Ok(());
    }
    // 域名：解析出全部地址，只要有一个落到内网就拒绝
    let addrs = tokio::net::lookup_host((host, 80))
        .await
        .map_err(|_| CommandError::new("主机解析失败"))?;
    let mut resolved = false;
    for addr in addrs {
        resolved = true;
        if is_blocked(&addr.ip()) {
            return Err(CommandError::new("不允许访问内网/保留地址"));
        }
    }
    if !resolved {
        return Err(CommandError::new("主机解析失败"));
    }
    Ok(())
}

/// 同步版 host 校验（重定向策略回调里无法 await）。
/// 返回 true 表示该 URL 的 host 解析后全为公网地址。
fn host_is_safe_sync(url: &str) -> bool {
    let Some(host) = extract_host(url) else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return !is_blocked(&ip);
    }
    let Ok(addrs) = (host, 80).to_socket_addrs() else {
        return false;
    };
    let mut resolved = false;
    for addr in addrs {
        resolved = true;
        if is_blocked(&addr.ip()) {
            return false;
        }
    }
    resolved
}

/// 抓取搜索页面 HTML，返回原文与状态码。
///
/// 前端负责解析 HTML 提取 RawSearchResult，Rust 不关心页面结构。
/// 失败时返回 CommandError，前端 describeError 直接展示给用户。
#[tauri::command]
pub async fn search_fetch(url: String) -> CommandResult<SearchFetchResponse> {
    // 基本 URL 校验：只允许 http/https
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(CommandError::new("只允许 http/https 地址"));
    }
    // 请求前先拦掉内网/回环/云元数据
    host_is_safe(&url).await?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        // 每次重定向在真正跟随前校验目标 host 是公网：禁止被跳进内网/回环
        // （含本机 Ollama 11434）后再读取；DNS rebinding 也在这里二次拦截
        .redirect(Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.stop();
            }
            if !host_is_safe_sync(attempt.url().as_str()) {
                return attempt.stop();
            }
            attempt.follow()
        }))
        .build()
        .map_err(|error| CommandError::new(format!("无法创建 HTTP 客户端：{error}")))?;

    let mut response = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                CommandError::new("搜索请求超时，请检查网络或换一个搜索引擎")
            } else if error.is_connect() {
                CommandError::new("无法连接搜索引擎，请检查网络")
            } else {
                CommandError::new(format!("搜索请求失败：{error}"))
            }
        })?;

    // 重定向后的最终地址也要是公网，防止被跳转到内网后再读取
    let final_url = response.url().to_string();
    if final_url != url {
        host_is_safe(&final_url).await?;
    }

    let status = response.status().as_u16();

    // 分块读取并限制总量：不信任 Content-Length，块式累计超过上限即报错
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| CommandError::new(format!("读取搜索页面失败：{error}")))?
    {
        if body.len() as u64 + chunk.len() as u64 > MAX_BODY_BYTES {
            return Err(CommandError::new("搜索页面响应过大"));
        }
        body.extend_from_slice(&chunk);
    }

    Ok(SearchFetchResponse {
        body: String::from_utf8_lossy(&body).into_owned(),
        status,
        final_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_host_handles_ports_ipv6_and_paths() {
        assert_eq!(extract_host("https://www.bing.com/search?q=x"), Some("www.bing.com"));
        assert_eq!(extract_host("http://localhost:11434/api/tags"), Some("localhost"));
        assert_eq!(extract_host("http://[::1]:8080/x"), Some("::1"));
        assert_eq!(extract_host("https://192.168.1.5/admin"), Some("192.168.1.5"));
        assert_eq!(extract_host("not-a-url"), None);
    }

    #[test]
    fn blocked_ips_cover_loopback_private_and_metadata() {
        assert!(is_blocked(&"127.0.0.1".parse().unwrap()));
        assert!(is_blocked(&"::1".parse().unwrap()));
        assert!(is_blocked(&"10.0.0.5".parse().unwrap()));
        assert!(is_blocked(&"192.168.1.1".parse().unwrap()));
        assert!(is_blocked(&"172.16.0.1".parse().unwrap()));
        // 云元数据
        assert!(is_blocked(&"169.254.169.254".parse().unwrap()));
        // 公网地址放行
        assert!(!is_blocked(&"1.1.1.1".parse().unwrap()));
        assert!(!is_blocked(&"8.8.8.8".parse().unwrap()));
    }
}
