mod batch;
mod daemon;
mod elevation;
mod expand;
mod framing;
mod handler;
mod headless;
mod logging;
mod process;
mod protocol;
mod pty;
mod shell;

use clap::Parser;
use clap::ValueEnum;

#[derive(Parser)]
#[command(name = "termora-agent", version)]
struct Cli {
    /// Run in stdio mode (default, used by hub LocalAgent)
    #[arg(long)]
    stdio: bool,

    /// Run as daemon (UDS server mode)
    #[arg(long)]
    daemon: bool,

    /// Socket path for daemon mode
    #[arg(long)]
    socket: Option<String>,

    /// Per-channel output buffer size (daemon mode)
    #[arg(long)]
    buffer_per_channel: Option<usize>,

    /// Global output buffer size (daemon mode)
    #[arg(long)]
    buffer_global: Option<usize>,

    /// Agent tracing level from the shared [logging] contract
    #[arg(long = "log-level", value_enum, default_value = "info")]
    log_level: LogLevel,

    /// Agent tracing line format from the shared [logging] contract
    #[arg(long = "format", value_enum, default_value = "jsonl")]
    format: LogFormat,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
enum LogFormat {
    Text,
    Jsonl,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
struct LoggingConfig {
    level: LogLevel,
    format: LogFormat,
}

impl From<&Cli> for LoggingConfig {
    fn from(cli: &Cli) -> Self {
        Self {
            level: cli.log_level,
            format: cli.format,
        }
    }
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Parse CLI args
    let cli = Cli::parse();
    let logging_config = LoggingConfig::from(&cli);

    init_tracing(logging_config, cli.daemon)?;

    if cli.daemon {
        // Daemon mode writes to its own log file; stdio mode writes to stderr.
        let log_path = logging::daemon_log_path();
        tracing::info!(log_path = %log_path.display(), "daemon log file opened");
        // Resolve socket path — platform-specific default when not provided via --socket
        let socket = cli.socket.unwrap_or_else(|| {
            #[cfg(unix)]
            {
                let state_dir = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
                    format!("{}/.local/state", home)
                });
                let dir = format!("{}/termora", state_dir);
                let _ = std::fs::create_dir_all(&dir);
                format!("{}/agent.socket", dir)
            }
            #[cfg(windows)]
            {
                let username = std::env::var("USERNAME").unwrap_or_else(|_| "default".into());
                format!(r"\\.\pipe\termora-agent-{}", username)
            }
            #[cfg(not(any(unix, windows)))]
            {
                "/tmp/termora-agent.socket".into()
            }
        });

        // Ensure the socket's parent directory exists when --socket is provided.
        // The unwrap_or_else default branch already calls create_dir_all for its
        // own path; an explicit --socket value may point to a directory that was
        // never created (e.g. /run/user/1000/termora/ under XDG_RUNTIME_DIR on
        // a freshly-booted WSL2 instance), causing UnixListener::bind to fail
        // with ENOENT and the daemon to exit silently.
        // On Windows the socket is a named pipe (\\.\pipe\...) with no real
        // parent directory — skip create_dir_all to avoid a misleading error.
        #[cfg(unix)]
        if let Some(parent) = std::path::Path::new(&socket).parent() {
            if !parent.as_os_str().is_empty() {
                use std::os::unix::fs::DirBuilderExt;
                if let Err(e) = std::fs::DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(parent)
                {
                    tracing::warn!(error = %e, dir = ?parent, "failed to create socket parent directory");
                }
            }
        }

        let socket_for_signal = socket.clone();

        // Spawn signal handler — cross-platform graceful shutdown
        tokio::spawn(async move {
            #[cfg(unix)]
            {
                use tokio::signal::unix::{signal, SignalKind};
                let mut sigterm = signal(SignalKind::terminate()).unwrap();
                let mut sigint = signal(SignalKind::interrupt()).unwrap();
                tokio::select! {
                    _ = sigterm.recv() => {
                        tracing::info!("SIGTERM received, shutting down");
                    }
                    _ = sigint.recv() => {
                        tracing::info!("SIGINT received, shutting down");
                    }
                }
                crate::elevation::cleanup_all();
                let _ = std::fs::remove_file(&socket_for_signal);
            }
            #[cfg(not(unix))]
            {
                let _ = &socket_for_signal; // suppress unused warning
                tokio::signal::ctrl_c().await.unwrap();
                tracing::info!("Ctrl+C received, shutting down");
                crate::elevation::cleanup_all();
            }
            std::process::exit(0);
        });

        daemon::run_daemon(socket).await?;
    } else {
        // Stdio mode — on Windows, prevent ConPTY children from inheriting
        // our stdout pipe (which carries the MessagePack protocol stream).
        #[cfg(windows)]
        protect_stdio_handles();

        handler::run_stdio().await?;
    }

    Ok(())
}

fn init_tracing(config: LoggingConfig, daemon: bool) -> std::io::Result<()> {
    if daemon {
        let log_path = logging::daemon_log_path();
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        match config.format {
            LogFormat::Jsonl => tracing_subscriber::fmt()
                .with_env_filter(env_filter(config.level))
                .json()
                .with_writer(log_file)
                .init(),
            LogFormat::Text => tracing_subscriber::fmt()
                .with_env_filter(env_filter(config.level))
                .with_target(false)
                .with_writer(log_file)
                .init(),
        }
    } else {
        match config.format {
            LogFormat::Jsonl => tracing_subscriber::fmt()
                .with_env_filter(env_filter(config.level))
                .json()
                .with_writer(std::io::stderr)
                .init(),
            LogFormat::Text => tracing_subscriber::fmt()
                .with_env_filter(env_filter(config.level))
                .with_target(false)
                .with_writer(std::io::stderr)
                .init(),
        }
    }
    Ok(())
}

fn env_filter(level: LogLevel) -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| format!("termora_agent={}", level.as_str()).into())
}

/// Replace stdout/stderr with non-inheritable duplicates.
///
/// When the hub spawns us with stdio pipes, Node.js creates inheritable handles.
/// `CreatePseudoConsole` internally spawns `conhost.exe` which inherits all
/// inheritable handles from the calling process — including our stdout pipe.
/// This causes ConPTY child output (e.g. cmd.exe banner) to leak onto our
/// stdout, corrupting the MessagePack protocol stream.
///
/// Simply clearing `HANDLE_FLAG_INHERIT` is not sufficient — conhost.exe may
/// bypass this flag. Instead, we DuplicateHandle each handle as non-inheritable,
/// close the original, and replace it via SetStdHandle. This ensures no
/// inheritable copy of our stdout pipe exists for conhost to find.
#[cfg(windows)]
fn protect_stdio_handles() {
    use windows_sys::Win32::Foundation::{
        CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::System::Console::{
        GetStdHandle, SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let current = GetCurrentProcess();
        for std_id in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            let old = GetStdHandle(std_id);
            if old.is_null() || old == INVALID_HANDLE_VALUE {
                continue;
            }
            let mut new_handle = INVALID_HANDLE_VALUE;
            let ok = DuplicateHandle(
                current,
                old,
                current,
                &mut new_handle,
                0,
                0, // bInheritHandle = FALSE
                DUPLICATE_SAME_ACCESS,
            );
            if ok != 0 && new_handle != INVALID_HANDLE_VALUE {
                CloseHandle(old);
                SetStdHandle(std_id, new_handle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logging_config_defaults_to_jsonl_info() {
        let cli = Cli::try_parse_from(["termora-agent"]).unwrap();
        let config = LoggingConfig::from(&cli);

        assert_eq!(config.level, LogLevel::Info);
        assert_eq!(config.format, LogFormat::Jsonl);
    }

    #[test]
    fn logging_config_reads_cli_level_and_format() {
        let cli = Cli::try_parse_from([
            "termora-agent",
            "--daemon",
            "--log-level",
            "debug",
            "--format",
            "text",
        ])
        .unwrap();
        let config = LoggingConfig::from(&cli);

        assert_eq!(config.level, LogLevel::Debug);
        assert_eq!(config.format, LogFormat::Text);
    }
}
