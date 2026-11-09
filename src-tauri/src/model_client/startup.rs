//! Shared desktop/Anna startup. Only starts an installed local service; never pulls models.
use super::OllamaClient;
use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

pub async fn ensure_running(client: &OllamaClient) -> Result<String, String> {
    static START: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let _guard = START
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    ensure_with(|| client.is_ready(), start_process, Duration::from_secs(10)).await
}

async fn ensure_with<F, Fut, S>(
    mut ready: F,
    start: S,
    deadline: Duration,
) -> Result<String, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
    S: FnOnce() -> std::io::Result<()>,
{
    if ready().await {
        return Ok("already_running".into());
    }
    start().map_err(|error| format!("无法启动 Ollama，请确认已安装：{error}"))?;
    let wait = async {
        loop {
            if ready().await {
                return "started".to_owned();
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    };
    Ok(tokio::time::timeout(deadline, wait)
        .await
        .unwrap_or_else(|_| "failed".into()))
}

fn start_process() -> std::io::Result<()> {
    let mut command = std::process::Command::new("ollama");
    command
        .arg("serve")
        .env("OLLAMA_HOST", "127.0.0.1:11434")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    // Reap on Unix as well; do not tie the user's Ollama lifetime to the app window.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_states_without_launching_or_downloading_anything() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let short = Duration::from_millis(10);
            assert_eq!(
                ensure_with(|| async { true }, || panic!("already running"), short)
                    .await
                    .unwrap(),
                "already_running"
            );
            let mut attempts = 0;
            assert_eq!(
                ensure_with(
                    || {
                        attempts += 1;
                        std::future::ready(attempts > 1)
                    },
                    || Ok(()),
                    short
                )
                .await
                .unwrap(),
                "started"
            );
            assert_eq!(
                ensure_with(|| async { false }, || Ok(()), short)
                    .await
                    .unwrap(),
                "failed"
            );
            assert!(ensure_with(
                || async { false },
                || Err(std::io::ErrorKind::NotFound.into()),
                short
            )
            .await
            .unwrap_err()
            .contains("已安装"));
        });
    }
}
