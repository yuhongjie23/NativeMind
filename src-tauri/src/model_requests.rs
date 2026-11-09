//! Per-window cancellation for desktop model requests. Dropping the HTTP future closes it.
//! Desktop IPC request lifecycle. The Anna runtime owns its separate job registry.
use crate::utils::{CommandError, CommandResult};
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::watch;

struct Entry {
    owner: String,
    started: bool,
    created: Instant,
    cancel: watch::Sender<bool>,
}
#[derive(Default)]
pub struct ModelRequests {
    next: AtomicU64,
    entries: Mutex<HashMap<String, Entry>>,
}

impl ModelRequests {
    pub fn begin(&self, owner: &str) -> CommandResult<String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CommandError::new("模型请求状态不可用"))?;
        entries
            .retain(|_, entry| entry.started || entry.created.elapsed() < Duration::from_secs(30));
        if entries.len() >= 64 {
            return Err(CommandError::new("模型请求过多，请稍后重试"));
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed).to_string();
        let (cancel, _) = watch::channel(false);
        entries.insert(
            id.clone(),
            Entry {
                owner: owner.into(),
                started: false,
                created: Instant::now(),
                cancel,
            },
        );
        Ok(id)
    }

    pub fn cancel(&self, owner: &str, id: &str) -> CommandResult<bool> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CommandError::new("模型请求状态不可用"))?;
        let Some(entry) = entries.get(id) else {
            return Ok(false);
        };
        if entry.owner != owner {
            return Err(CommandError::new("不能取消其他窗口的请求"));
        }
        if let Some(entry) = entries.remove(id) {
            entry.cancel.send_replace(true);
        }
        Ok(true)
    }

    pub async fn run<T>(
        &self,
        owner: &str,
        id: Option<&str>,
        work: impl Future<Output = CommandResult<T>>,
    ) -> CommandResult<T> {
        // Compatibility for callers predating cancellable requests.
        let Some(id) = id else {
            return work.await;
        };
        let mut cancelled = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| CommandError::new("模型请求状态不可用"))?;
            let entry = entries
                .get_mut(id)
                .ok_or_else(|| CommandError::new("模型请求已取消或过期"))?;
            if entry.owner != owner || entry.started {
                return Err(CommandError::new("模型请求身份无效或已启动"));
            }
            entry.started = true;
            entry.cancel.subscribe()
        };
        let _cleanup = RequestGuard { requests: self, id };
        tokio::select! {
            biased;
            _ = cancelled.changed() => Err(CommandError::new("模型请求已取消")),
            result = work => result,
        }
    }
}

struct RequestGuard<'a> {
    requests: &'a ModelRequests,
    id: &'a str,
}
impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.requests.entries.lock() {
            entries.remove(self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::AtomicBool,
    };

    #[tokio::test]
    async fn cancelled_reservation_never_polls_work() {
        let requests = ModelRequests::default();
        let id = requests.begin("main").unwrap();
        requests.cancel("main", &id).unwrap();
        let polled = AtomicBool::new(false);
        assert!(requests
            .run("main", Some(&id), async {
                polled.store(true, Ordering::SeqCst);
                Ok(())
            })
            .await
            .is_err());
        assert!(!polled.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn ownership_completion_and_failure_cleanup() {
        let requests = ModelRequests::default();
        let id = requests.begin("main").unwrap();
        assert!(requests.cancel("other", &id).is_err());
        assert!(requests
            .run("other", Some(&id), async { Ok(()) })
            .await
            .is_err());
        assert_eq!(
            requests
                .run("main", Some(&id), async { Ok(42) })
                .await
                .unwrap(),
            42
        );
        assert!(!requests.cancel("main", &id).unwrap());
        let failed = requests.begin("main").unwrap();
        assert!(requests
            .run::<()>("main", Some(&failed), async {
                Err(CommandError::new("failed"))
            })
            .await
            .is_err());
        assert!(requests.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn abandoned_reservations_are_bounded_and_expire() {
        let requests = ModelRequests::default();
        for _ in 0..64 {
            requests.begin("main").unwrap();
        }
        assert!(requests.begin("main").is_err());
        for entry in requests.entries.lock().unwrap().values_mut() {
            entry.created = Instant::now() - Duration::from_secs(31);
        }
        requests.begin("main").unwrap();
        assert_eq!(requests.entries.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cancelling_stream_closes_http_and_preserves_other_request() {
        use crate::model_client::{CompletionRequest, OllamaClient};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut buf = [0; 4096];
            socket.read(&mut buf).unwrap();
            let chunk = "{\"response\":\"first\",\"done\":false}\n";
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n", chunk.len(), chunk).unwrap();
            socket.flush().unwrap();
            loop {
                match socket.read(&mut buf) {
                    Ok(0) => return true,
                    Ok(_) => {}
                    Err(error) => return error.kind() == std::io::ErrorKind::ConnectionReset,
                }
            }
        });
        let requests = ModelRequests::default();
        let id = requests.begin("main").unwrap();
        let other = requests.begin("main").unwrap();
        let ready = tokio::sync::Notify::new();
        let base_url = format!("http://{address}");
        let client = OllamaClient::new(Some(&base_url)).unwrap();
        let payload = CompletionRequest {
            model: "fake".into(),
            prompt: "synthetic".into(),
            system: None,
            json: false,
            json_schema: None,
            temperature: None,
            max_tokens: Some(10),
            base_url: None,
            timeout_ms: Some(2000),
        };
        let work = requests.run(
            "main",
            Some(&id),
            client.complete_stream(payload, |_| ready.notify_one()),
        );
        let stop = async {
            ready.notified().await;
            requests.cancel("main", &id).unwrap();
        };
        let (result, _) =
            tokio::time::timeout(Duration::from_secs(4), async { tokio::join!(work, stop) })
                .await
                .unwrap();
        assert!(result.unwrap_err().to_string().contains("取消"));
        // Let reqwest's connection driver process the dropped response on this runtime.
        assert!(
            tokio::task::spawn_blocking(move || server.join().unwrap())
                .await
                .unwrap(),
            "the HTTP connection must close after cancellation"
        );
        assert_eq!(
            requests
                .run("main", Some(&other), async { Ok(7) })
                .await
                .unwrap(),
            7
        );
        assert!(requests.entries.lock().unwrap().is_empty());
    }
}
