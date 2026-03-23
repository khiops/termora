mod batch;
mod logging;
mod daemon;
mod elevation;
mod expand;
mod framing;
mod handler;
mod headless;
mod process;
mod protocol;
mod pty;
mod shell;

use clap::Parser;

#[derive(Parser)]
#[command(name = "nexterm-agent", version)]
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
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
	// Parse CLI args
	let cli = Cli::parse();

	// Init logging: daemon mode writes JSONL to file; stdio mode writes to stderr.
	if cli.daemon {
		let log_path = logging::daemon_log_path();
		let log_file = std::fs::OpenOptions::new()
			.create(true)
			.append(true)
			.open(&log_path)?;
		tracing_subscriber::fmt()
			.with_env_filter(
				tracing_subscriber::EnvFilter::try_from_default_env()
					.unwrap_or_else(|_| "nexterm_agent=info".into()),
			)
			.json()
			.with_writer(log_file)
			.init();
		tracing::info!(log_path = %log_path.display(), "daemon log file opened");
	} else {
		tracing_subscriber::fmt()
			.with_env_filter(
				tracing_subscriber::EnvFilter::try_from_default_env()
					.unwrap_or_else(|_| "nexterm_agent=info".into()),
			)
			.with_target(false)
			.with_writer(std::io::stderr)
			.init();
	}

	if cli.daemon {
		// Resolve socket path — platform-specific default when not provided via --socket
		let socket = cli.socket.unwrap_or_else(|| {
			#[cfg(unix)]
			{
				let state_dir = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| {
					let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
					format!("{}/.local/state", home)
				});
				let dir = format!("{}/nexterm", state_dir);
				let _ = std::fs::create_dir_all(&dir);
				format!("{}/agent.socket", dir)
			}
			#[cfg(windows)]
			{
				let username =
					std::env::var("USERNAME").unwrap_or_else(|_| "default".into());
				format!(r"\\.\pipe\nexterm-agent-{}", username)
			}
			#[cfg(not(any(unix, windows)))]
			{
				"/tmp/nexterm-agent.socket".into()
			}
		});

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

