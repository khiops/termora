mod batch;
#[cfg(unix)]
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
	/// Run as daemon (UDS server mode)
	#[arg(long)]
	daemon: bool,

	/// Socket path for daemon mode
	#[arg(long)]
	socket: Option<String>,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
	// Parse CLI args
	let cli = Cli::parse();

	// Init logging
	tracing_subscriber::fmt()
		.with_env_filter(
			tracing_subscriber::EnvFilter::try_from_default_env()
				.unwrap_or_else(|_| "nexterm_agent=info".into()),
		)
		.with_target(false)
		.with_writer(std::io::stderr)
		.init();

	if cli.daemon {
		#[cfg(unix)]
		{
			let socket = cli.socket.unwrap_or_else(|| {
				let state_dir = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| {
					let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
					format!("{}/.local/state", home)
				});
				let dir = format!("{}/nexterm", state_dir);
				let _ = std::fs::create_dir_all(&dir);
				format!("{}/agent.socket", dir)
			});

			let socket_for_signal = socket.clone();
			tokio::spawn(async move {
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
				std::process::exit(0);
			});

			daemon::run_daemon(socket).await?;
		}
		#[cfg(not(unix))]
		{
			return Err(std::io::Error::new(
				std::io::ErrorKind::Unsupported,
				"daemon mode is not supported on Windows (use stdio mode)",
			));
		}
	} else {
		// Stdio mode
		handler::run_stdio().await?;
	}

	Ok(())
}
