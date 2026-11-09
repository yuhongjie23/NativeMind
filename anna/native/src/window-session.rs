//! Local UI connection fencing, not production authentication.
use crate::utils::{CommandError, CommandResult};
use std::time::{Duration, Instant};

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(15);

pub struct WindowSession {
    pub client: String,
    pub token: String,
    touched: Instant,
}

impl WindowSession {
    pub fn new(client: &str) -> CommandResult<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|_| CommandError::new("无法生成安全连接凭据，请重启本地服务"))?;
        Ok(Self {
            client: client.into(),
            token: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
            touched: Instant::now(),
        })
    }
    pub fn expired(&self) -> bool {
        self.touched.elapsed() >= IDLE_TIMEOUT
    }
    pub fn authorize(&mut self, client: &str, token: Option<&str>) -> CommandResult<()> {
        if self.client != client || token != Some(self.token.as_str()) {
            return Err(CommandError::new(
                "ANNA_SESSION_EXPIRED: 本页面连接已失效，请关闭其他页面后重新打开",
            ));
        }
        self.touched = Instant::now();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expired_connection_can_be_recognised_without_accepting_old_generation() {
        let mut session = WindowSession::new("same-window").unwrap();
        let token = session.token.clone();
        session.touched = Instant::now() - IDLE_TIMEOUT;
        assert!(session.expired());
        assert!(session.authorize("same-window", Some("1")).is_err());
        assert!(session.authorize("other-window", Some(&token)).is_err());
        assert!(session.expired());
        session.authorize("same-window", Some(&token)).unwrap();
        assert!(!session.expired());
    }
    #[test]
    fn fresh_session_for_same_client_never_reuses_old_credentials() {
        let old = WindowSession::new("same-window").unwrap();
        let mut current = WindowSession::new("same-window").unwrap();
        assert_eq!(current.token.len(), 64);
        assert!(current.token.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(old.token, current.token);
        assert!(current.authorize("same-window", Some(&old.token)).is_err());
        assert!(current.authorize("same-window", None).is_err());
    }
}
