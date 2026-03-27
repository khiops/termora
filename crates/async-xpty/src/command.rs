//! [`CommandBuilder`] — ergonomic builder for spawning PTY processes.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::{PtyProcess, PtySize};

/// Builder for spawning a command inside a PTY.
///
/// # Example
///
/// ```no_run
/// use async_xpty::CommandBuilder;
///
/// # #[tokio::main]
/// # async fn main() -> std::io::Result<()> {
/// let mut pty = CommandBuilder::new("/bin/bash")
///     .env("TERM", "xterm-256color")
///     .current_dir("/home/user")
///     .size(220, 50)
///     .spawn()
///     .await?;
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct CommandBuilder {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) env: HashMap<String, String>,
    pub(crate) env_clear: bool,
    pub(crate) size: PtySize,
}

impl CommandBuilder {
    /// Create a new builder for `program`.
    ///
    /// `program` may be a full path or a name looked up in `PATH`.
    pub fn new(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            env_clear: false,
            size: PtySize::default(),
        }
    }

    /// Append a single argument.
    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    /// Append multiple arguments.
    pub fn args(mut self, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.args.extend(args.into_iter().map(|a| a.into()));
        self
    }

    /// Set the working directory for the child process.
    pub fn current_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.cwd = Some(dir.into());
        self
    }

    /// Set a single environment variable.
    pub fn env(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.env.insert(key.into(), val.into());
        self
    }

    /// Set multiple environment variables.
    pub fn envs(
        mut self,
        vars: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>,
    ) -> Self {
        for (k, v) in vars {
            self.env.insert(k.into(), v.into());
        }
        self
    }

    /// Clear the inherited environment before applying any [`env`](Self::env)
    /// overrides.
    pub fn env_clear(mut self) -> Self {
        self.env_clear = true;
        self
    }

    /// Set the initial PTY window size (columns × rows).
    ///
    /// Defaults to 80×24 if not specified.
    pub fn size(mut self, cols: u16, rows: u16) -> Self {
        self.size = PtySize { cols, rows };
        self
    }

    /// Spawn the command inside a new PTY and return a [`PtyProcess`].
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY cannot be created, the process cannot be
    /// forked, or `execvp` fails (e.g. program not found).
    pub async fn spawn(self) -> std::io::Result<PtyProcess> {
        #[cfg(unix)]
        {
            let inner = crate::unix::spawn(self).await?;
            Ok(PtyProcess { inner })
        }

        #[cfg(windows)]
        {
            let inner = crate::windows::spawn(self).await?;
            Ok(PtyProcess { inner })
        }

        #[cfg(not(any(unix, windows)))]
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "async-xpty: platform not supported",
        ))
    }
}
