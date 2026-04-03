use std::collections::HashMap;

use async_xpty::{CommandBuilder, PtyProcess};

pub struct PtyChannel {
    pub process: PtyProcess,
    pub seq: u64,
}

pub struct PtyManager {
    pub(crate) channels: HashMap<String, PtyChannel>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            channels: HashMap::new(),
        }
    }

    /// Spawn a new PTY channel. Returns (channel_id, pid).
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn(
        &mut self,
        channel_id: Option<String>,
        shell: &str,
        args: &[String],
        cwd: Option<&str>,
        env: Option<&HashMap<String, String>>,
        cols: u16,
        rows: u16,
    ) -> std::io::Result<(String, u32)> {
        if let Some(ref id) = channel_id {
            if self.channels.contains_key(id) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "channel already exists",
                ));
            }
        }

        let id = channel_id.unwrap_or_else(|| ulid::Ulid::new().to_string().to_lowercase());

        let mut cmd = CommandBuilder::new(shell);
        for arg in args {
            cmd = cmd.arg(arg);
        }
        if let Some(d) = cwd {
            cmd = cmd.current_dir(d);
        }
        if let Some(e) = env {
            for (k, v) in e {
                cmd = cmd.env(k, v);
            }
        }
        cmd = cmd.size(cols, rows);

        let process = cmd.spawn().await?;
        let pid = process.pid();
        self.channels
            .insert(id.clone(), PtyChannel { process, seq: 0 });
        Ok((id, pid))
    }

    #[allow(dead_code)] // Used in tests
    pub fn get_mut(&mut self, channel_id: &str) -> Option<&mut PtyChannel> {
        self.channels.get_mut(channel_id)
    }

    pub fn remove(&mut self, channel_id: &str) -> Option<PtyChannel> {
        self.channels.remove(channel_id)
    }

    #[allow(dead_code)] // Used in tests
    pub fn contains(&self, channel_id: &str) -> bool {
        self.channels.contains_key(channel_id)
    }

    #[allow(dead_code)] // Used in tests
    pub fn channel_ids(&self) -> Vec<String> {
        self.channels.keys().cloned().collect()
    }

    /// Destroy all channels (graceful shutdown).
    pub async fn destroy_all(&mut self) {
        let ids: Vec<String> = self.channels.keys().cloned().collect();
        for id in ids {
            if let Some(ch) = self.channels.remove(&id) {
                let _ = ch.process.kill();
            }
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_spawn_channel() {
        let mut mgr = PtyManager::new();
        let (id, pid) = mgr
            .spawn(None, "/bin/sh", &[], None, None, 80, 24)
            .await
            .unwrap();
        assert!(!id.is_empty());
        assert!(pid > 0);
        assert!(mgr.contains(&id));
        // Cleanup
        if let Some(ch) = mgr.remove(&id) {
            let _ = ch.process.kill();
        }
    }

    #[tokio::test]
    async fn test_duplicate_channel_id_rejected() {
        let mut mgr = PtyManager::new();
        let fixed_id = "test-channel-01".to_string();
        let (id, _) = mgr
            .spawn(Some(fixed_id.clone()), "/bin/sh", &[], None, None, 80, 24)
            .await
            .unwrap();
        assert_eq!(id, fixed_id);

        let err = mgr
            .spawn(Some(fixed_id.clone()), "/bin/sh", &[], None, None, 80, 24)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);

        // Cleanup
        if let Some(ch) = mgr.remove(&fixed_id) {
            let _ = ch.process.kill();
        }
    }

    #[tokio::test]
    async fn test_destroy_all() {
        let mut mgr = PtyManager::new();
        mgr.spawn(None, "/bin/sh", &[], None, None, 80, 24)
            .await
            .unwrap();
        mgr.spawn(None, "/bin/sh", &[], None, None, 80, 24)
            .await
            .unwrap();
        assert_eq!(mgr.channel_ids().len(), 2);
        mgr.destroy_all().await;
        assert_eq!(mgr.channel_ids().len(), 0);
    }
}
