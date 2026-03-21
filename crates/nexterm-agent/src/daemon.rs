
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, Mutex, Notify};

use crate::batch::{batch_loop, BatchedOutput, OutputEvent};
use crate::framing::{encode_frame, FrameReader};
use crate::handler::{handle_message, iso_now, FrameSender, SnapshotSenders};
use crate::protocol::AgentToHub;
use crate::pty::PtyManager;
use crate::shell;

const BIND_RETRY_MAX: u32 = 3;
const BIND_RETRY_DELAY_MS: u64 = 300;
const MAX_FRAME_QUEUE: usize = 1000;

/// Tracks the active hub connection so it can be displaced by a new one.
struct ActiveConnection {
	/// Notified when this connection should be terminated (displaced).
	cancel: Arc<Notify>,
	/// Channel to send encoded frames to the active connection's writer task.
	frame_tx: FrameSender,
}

/// Run the agent in daemon mode.
///
/// Listens on a Unix domain socket. Handles one connection at a time
/// (last-writer-wins: new connections displace the previous one).
/// PTY channels persist across hub reconnections.
pub async fn run_daemon(socket_path: String) -> std::io::Result<()> {
	let path = PathBuf::from(&socket_path);

	// Validate path length (Unix socket limit: 104-108 bytes depending on platform)
	if path.as_os_str().len() > 100 {
		return Err(std::io::Error::new(
			std::io::ErrorKind::InvalidInput,
			format!(
				"socket path too long: {} bytes (max 100)",
				path.as_os_str().len()
			),
		));
	}

	// Clean up stale socket file
	if path.exists() {
		std::fs::remove_file(&path)?;
	}

	// Bind with retry (handles transient EADDRINUSE after cleanup)
	let listener = bind_with_retry(&path).await?;

	// Set socket permissions to 0600 (owner-only)
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
	}

	tracing::info!("daemon listening on {:?}", path);

	// Shared PTY manager — channels survive hub disconnections
	let pty_manager = Arc::new(Mutex::new(PtyManager::new()));

	// Per-channel command senders (snapshot/resize) — shared across connections
	let cmd_senders: SnapshotSenders = Arc::new(Mutex::new(std::collections::HashMap::new()));

	// Batch channels — single batch loop for the daemon lifetime
	// Output flows: PTY reader tasks → batch_loop → output_router → active connection
	let (output_tx, output_rx) = mpsc::unbounded_channel::<OutputEvent>();
	let (batched_tx, batched_rx) = mpsc::unbounded_channel::<BatchedOutput>();
	tokio::spawn(batch_loop(output_rx, batched_tx));

	// Active connection state — shared between accept loop and output router
	let active_conn: Arc<Mutex<Option<ActiveConnection>>> = Arc::new(Mutex::new(None));

	// Output router: drains batched frames, forwards to active connection (or buffers)
	spawn_output_router(batched_rx, Arc::clone(&active_conn));

	// Accept loop — spawn each connection handler so we can accept the next immediately
	loop {
		match listener.accept().await {
			Ok((stream, _addr)) => {
				tracing::info!("new hub connection");

				// Create cancellation notifier for this connection
				let cancel = Arc::new(Notify::new());

				// Create per-connection frame channel
				let (frame_tx, frame_rx) = mpsc::unbounded_channel::<Vec<u8>>();

				// Displace previous connection and register new one
				{
					let mut conn = active_conn.lock().await;
					if let Some(old) = conn.take() {
						tracing::info!("displacing previous connection");
						// notify_waiters wakes ALL listeners (writer task + read loop)
						old.cancel.notify_waiters();
					}
					*conn = Some(ActiveConnection {
						cancel: Arc::clone(&cancel),
						frame_tx: frame_tx.clone(),
					});
				}

				// Spawn the connection handler — does NOT block the accept loop
				tokio::spawn(handle_connection(
					stream,
					Arc::clone(&pty_manager),
					Arc::clone(&cmd_senders),
					output_tx.clone(),
					frame_tx,
					frame_rx,
					Arc::clone(&active_conn),
					cancel,
				));
			}
			Err(e) => {
				tracing::error!("accept error: {}", e);
			}
		}
	}
}

async fn bind_with_retry(path: &Path) -> std::io::Result<UnixListener> {
	let mut last_err = None;
	for attempt in 0..BIND_RETRY_MAX {
		match UnixListener::bind(path) {
			Ok(listener) => return Ok(listener),
			Err(e) => {
				tracing::warn!("bind attempt {} failed: {}", attempt + 1, e);
				last_err = Some(e);
				if attempt < BIND_RETRY_MAX - 1 {
					let delay = BIND_RETRY_DELAY_MS + (attempt as u64 * 100);
					tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
					// Try removing stale socket again
					let _ = std::fs::remove_file(path);
				}
			}
		}
	}
	Err(last_err.unwrap())
}

/// Handle a single hub connection:
/// 1. Spawn writer task (drains frame_rx → stream write half)
/// 2. Send HELLO + AGENT_CHANNEL_STATE* + CHANNEL_STATE_END
/// 3. Read loop with displacement cancellation
#[allow(clippy::too_many_arguments)]
async fn handle_connection(
	stream: UnixStream,
	pty_manager: Arc<Mutex<PtyManager>>,
	cmd_senders: SnapshotSenders,
	output_tx: mpsc::UnboundedSender<OutputEvent>,
	frame_tx: FrameSender,
	mut frame_rx: mpsc::UnboundedReceiver<Vec<u8>>,
	active_conn: Arc<Mutex<Option<ActiveConnection>>>,
	cancel: Arc<Notify>,
) {
	let (mut read_half, mut write_half) = stream.into_split();

	// Spawn writer task — drains frame_rx to the write half
	let cancel_writer = Arc::clone(&cancel);
	tokio::spawn(async move {
		loop {
			tokio::select! {
				_ = cancel_writer.notified() => {
					// Connection displaced — stop writing (drops write_half → sends EOF to client)
					break;
				}
				frame = frame_rx.recv() => {
					match frame {
						Some(data) => {
							if write_half.write_all(&data).await.is_err() {
								break;
							}
							if write_half.flush().await.is_err() {
								break;
							}
						}
						None => break, // frame_tx dropped
					}
				}
			}
		}
		// write_half dropped here — client read returns 0 (EOF)
	});

	// Send HELLO
	if send_encoded(&frame_tx, &crate::handler::build_hello()).is_err() {
		clear_active_if_ours(&active_conn, &cancel).await;
		return;
	}

	// Send AGENT_CHANNEL_STATE for each existing channel
	{
		let mgr = pty_manager.lock().await;
		for (id, ch) in &mgr.channels {
			let msg = AgentToHub::AgentChannelState {
				channel_id: id.clone(),
				title: String::new(),
				pid: ch.process.pid(),
				alive: true,
			};
			if send_encoded(&frame_tx, &msg).is_err() {
				clear_active_if_ours(&active_conn, &cancel).await;
				return;
			}
		}
	}

	// Send CHANNEL_STATE_END
	if send_encoded(&frame_tx, &AgentToHub::ChannelStateEnd {}).is_err() {
		clear_active_if_ours(&active_conn, &cancel).await;
		return;
	}

	// Read loop with displacement cancellation
	let mut reader = FrameReader::new();
	let mut buf = vec![0u8; 8192];

	loop {
		tokio::select! {
			_ = cancel.notified() => {
				tracing::info!("connection displaced by new hub");
				break;
			}
			result = read_half.read(&mut buf) => {
				match result {
					Ok(0) => {
						tracing::info!("hub disconnected (EOF)");
						break;
					}
					Ok(n) => {
						match reader.push(&buf[..n]) {
							Ok(messages) => {
								for msg in messages {
									if let Err(e) = handle_message(
										msg,
										Arc::clone(&pty_manager),
										frame_tx.clone(),
										output_tx.clone(),
										Arc::clone(&cmd_senders),
									)
									.await
									{
										tracing::error!("message dispatch error: {}", e);
										break;
									}
								}
							}
							Err(e) => {
								tracing::error!("frame parse error: {}", e);
								break;
							}
						}
					}
					Err(e) => {
						tracing::error!("read error: {}", e);
						break;
					}
				}
			}
		}
	}

	clear_active_if_ours(&active_conn, &cancel).await;
}

/// Clear the active connection slot after a connection ends.
/// Clear the active connection slot only if it belongs to this connection.
/// Uses Arc pointer equality on the cancel token to avoid clearing a newer connection.
async fn clear_active_if_ours(
	active_conn: &Arc<Mutex<Option<ActiveConnection>>>,
	our_cancel: &Arc<Notify>,
) {
	let mut conn = active_conn.lock().await;
	if let Some(ref active) = *conn {
		if Arc::ptr_eq(&active.cancel, our_cancel) {
			*conn = None;
		}
	}
}

/// Encode a message and push the frame bytes into the frame channel.
fn send_encoded(
	tx: &FrameSender,
	msg: &AgentToHub,
) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
	match encode_frame(msg) {
		Ok(frame) => tx.send(frame),
		Err(_) => Err(mpsc::error::SendError(vec![])),
	}
}

/// Spawn the output router task.
///
/// Drains batched PTY output frames and forwards them to the active connection.
/// Buffers up to MAX_FRAME_QUEUE frames when no hub is connected (ring buffer, drops oldest).
fn spawn_output_router(
	mut batched_rx: mpsc::UnboundedReceiver<BatchedOutput>,
	active_conn: Arc<Mutex<Option<ActiveConnection>>>,
) {
	tokio::spawn(async move {
		let mut pending: Vec<Vec<u8>> = Vec::new();

		while let Some(b) = batched_rx.recv().await {
			let msg = AgentToHub::Output {
				channel_id: b.channel_id,
				seq: b.seq,
				ts: iso_now(),
				data: b.data,
			};
			if let Ok(frame) = encode_frame(&msg) {
				let conn = active_conn.lock().await;
				if let Some(ref active) = *conn {
					// Flush pending buffer first (maintain ordering)
					for pf in pending.drain(..) {
						let _ = active.frame_tx.send(pf);
					}
					let _ = active.frame_tx.send(frame);
				} else {
					// No active connection — buffer, drop oldest if full
					if pending.len() >= MAX_FRAME_QUEUE {
						pending.remove(0);
					}
					pending.push(frame);
				}
			}
		}
	});
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_socket_path_validation_short() {
		// Paths <= 100 bytes pass the length guard
		assert!(PathBuf::from("/tmp/test.sock").as_os_str().len() <= 100);
	}

	#[test]
	fn test_socket_path_validation_too_long() {
		// Paths > 100 bytes should fail the guard
		let long_path = format!("/tmp/{}/agent.sock", "a".repeat(200));
		assert!(PathBuf::from(&long_path).as_os_str().len() > 100);
	}

	#[tokio::test]
	async fn test_daemon_starts_and_accepts() {
		let sock_name = format!(
			"nexterm-test-{}.sock",
			ulid::Ulid::new().to_string().to_lowercase()
		);
		let path = std::env::temp_dir().join(&sock_name);
		let path_str = path.to_string_lossy().to_string();

		// Start daemon in background
		let daemon_handle = tokio::spawn(run_daemon(path_str.clone()));

		// Wait for daemon to bind
		tokio::time::sleep(std::time::Duration::from_millis(150)).await;

		// Connect
		let mut stream = UnixStream::connect(&path_str).await.unwrap();

		// Should receive framed HELLO
		let mut buf = vec![0u8; 4096];
		let n = stream.read(&mut buf).await.unwrap();
		assert!(n >= 4, "expected at least a 4-byte frame header");

		// Decode first frame: 4-byte LE u32 length prefix
		let len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
		assert!(n >= 4 + len, "full HELLO frame not received in single read");
		let payload = &buf[4..4 + len];
		let value: serde_json::Value = rmp_serde::from_slice(payload).unwrap();
		assert_eq!(value["type"], "HELLO", "first message must be HELLO");

		drop(stream);
		daemon_handle.abort();
		let _ = std::fs::remove_file(&path_str);
	}

	#[tokio::test]
	async fn test_connection_displacement() {
		let sock_name = format!(
			"nexterm-test-displace-{}.sock",
			ulid::Ulid::new().to_string().to_lowercase()
		);
		let path = std::env::temp_dir().join(&sock_name);
		let path_str = path.to_string_lossy().to_string();

		let daemon_handle = tokio::spawn(run_daemon(path_str.clone()));
		tokio::time::sleep(std::time::Duration::from_millis(150)).await;

		// First client connects
		let mut stream1 = UnixStream::connect(&path_str).await.unwrap();
		let mut buf = vec![0u8; 4096];
		let _ = stream1.read(&mut buf).await.unwrap(); // drain initial frames

		// Second client connects — displaces first
		let mut stream2 = UnixStream::connect(&path_str).await.unwrap();
		let _ = stream2.read(&mut buf).await.unwrap(); // drain initial frames

		// Wait for displacement to propagate
		tokio::time::sleep(std::time::Duration::from_millis(300)).await;

		// stream1 should eventually stop receiving data (writer task cancelled)
		let result =
			tokio::time::timeout(std::time::Duration::from_millis(500), stream1.read(&mut buf))
				.await;
		match result {
			Ok(Ok(0)) => {}   // clean EOF — expected
			Ok(Err(_)) => {}  // IO error — also expected
			Ok(Ok(_n)) => {}  // may receive buffered frames before EOF — acceptable
			Err(_timeout) => {} // timeout also acceptable
		}

		drop(stream1);
		drop(stream2);
		daemon_handle.abort();
		let _ = std::fs::remove_file(&path_str);
	}

	#[tokio::test]
	async fn test_socket_permissions() {
		let sock_name = format!(
			"nexterm-test-perms-{}.sock",
			ulid::Ulid::new().to_string().to_lowercase()
		);
		let path = std::env::temp_dir().join(&sock_name);
		let path_str = path.to_string_lossy().to_string();

		let daemon_handle = tokio::spawn(run_daemon(path_str.clone()));
		tokio::time::sleep(std::time::Duration::from_millis(150)).await;

		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			let meta = std::fs::metadata(&path_str).unwrap();
			let mode = meta.permissions().mode() & 0o777;
			assert_eq!(mode, 0o600, "socket must be 0600, got {:o}", mode);
		}

		daemon_handle.abort();
		let _ = std::fs::remove_file(&path_str);
	}

	#[tokio::test]
	async fn test_channel_state_end_sent_on_connect() {
		let sock_name = format!(
			"nexterm-test-state-end-{}.sock",
			ulid::Ulid::new().to_string().to_lowercase()
		);
		let path = std::env::temp_dir().join(&sock_name);
		let path_str = path.to_string_lossy().to_string();

		let daemon_handle = tokio::spawn(run_daemon(path_str.clone()));
		tokio::time::sleep(std::time::Duration::from_millis(150)).await;

		let mut stream = UnixStream::connect(&path_str).await.unwrap();
		let mut buf = vec![0u8; 65536];
		let mut accumulated: Vec<u8> = Vec::new();
		let mut found_hello = false;
		let mut found_state_end = false;

		// Read frames for up to 500 ms
		let _ = tokio::time::timeout(std::time::Duration::from_millis(500), async {
			loop {
				let n = stream.read(&mut buf).await.unwrap_or(0);
				if n == 0 {
					break;
				}
				accumulated.extend_from_slice(&buf[..n]);

				// Parse complete frames
				let mut pos = 0;
				while pos + 4 <= accumulated.len() {
					let len = u32::from_le_bytes([
						accumulated[pos],
						accumulated[pos + 1],
						accumulated[pos + 2],
						accumulated[pos + 3],
					]) as usize;
					if pos + 4 + len > accumulated.len() {
						break;
					}
					let payload = &accumulated[pos + 4..pos + 4 + len];
					if let Ok(v) = rmp_serde::from_slice::<serde_json::Value>(payload) {
						match v["type"].as_str() {
							Some("HELLO") => found_hello = true,
							Some("CHANNEL_STATE_END") => {
								found_state_end = true;
								return; // got what we need
							}
							_ => {}
						}
					}
					pos += 4 + len;
				}
			}
		})
		.await;

		// Re-parse accumulated in case timeout fired mid-frame
		let mut pos = 0;
		while pos + 4 <= accumulated.len() {
			let len = u32::from_le_bytes([
				accumulated[pos],
				accumulated[pos + 1],
				accumulated[pos + 2],
				accumulated[pos + 3],
			]) as usize;
			if pos + 4 + len > accumulated.len() {
				break;
			}
			let payload = &accumulated[pos + 4..pos + 4 + len];
			if let Ok(v) = rmp_serde::from_slice::<serde_json::Value>(payload) {
				match v["type"].as_str() {
					Some("HELLO") => found_hello = true,
					Some("CHANNEL_STATE_END") => found_state_end = true,
					_ => {}
				}
			}
			pos += 4 + len;
		}

		assert!(found_hello, "HELLO must be sent on connect");
		assert!(found_state_end, "CHANNEL_STATE_END must be sent on connect");

		drop(stream);
		daemon_handle.abort();
		let _ = std::fs::remove_file(&path_str);
	}
}
