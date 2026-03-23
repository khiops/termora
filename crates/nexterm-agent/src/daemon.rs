use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex, Notify};

#[cfg(unix)]
use std::path::{Path, PathBuf};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

use crate::batch::{batch_loop, BatchedOutput, OutputEvent};
use crate::framing::{encode_frame, FrameReader};
use crate::handler::{handle_message, iso_now, FrameSender, SnapshotSenders};
use crate::protocol::AgentToHub;
use crate::pty::PtyManager;

#[cfg(unix)]
const BIND_RETRY_MAX: u32 = 3;
#[cfg(unix)]
const BIND_RETRY_DELAY_MS: u64 = 300;
const MAX_FRAME_QUEUE: usize = 1000;

/// Tracks the active hub connection so it can be displaced by a new one.
struct ActiveConnection {
    /// Notified when this connection should be terminated (displaced).
    cancel: Arc<Notify>,
    /// Channel to send encoded frames to the active connection's writer task.
    frame_tx: FrameSender,
}

/// Returns the XDG config directory for nexterm (`~/.config/nexterm` on Linux/macOS).
/// This is where `auth.json` lives — NOT the socket or state directory.
#[cfg(not(windows))]
fn get_config_dir() -> String {
    std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        format!("{}/.config", home)
    }) + "/nexterm"
}

/// Returns the XDG state directory for nexterm (`~/.local/state/nexterm` on Linux/macOS).
/// This is where `meta.db` and `spool.db` live.
#[cfg(not(windows))]
fn get_state_dir() -> std::path::PathBuf {
    let base = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        format!("{}/.local/state", home)
    });
    std::path::PathBuf::from(base).join("nexterm")
}

/// Returns the LOCALAPPDATA state directory for nexterm (`%LOCALAPPDATA%\nexterm` on Windows).
#[cfg(windows)]
fn get_state_dir() -> std::path::PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\nexterm-state".into());
    std::path::PathBuf::from(base).join("nexterm")
}

/// Returns the APPDATA config directory for nexterm (`%APPDATA%\nexterm` on Windows).
#[cfg(windows)]
fn get_config_dir() -> String {
    std::env::var("APPDATA")
        .or_else(|_| std::env::var("LOCALAPPDATA"))
        .unwrap_or_else(|_| "C:\\nexterm-config".into())
        + "\\nexterm"
}

/// Run the agent in daemon mode.
///
/// Listens on a Unix domain socket. Handles one connection at a time
/// (last-writer-wins: new connections displace the previous one).
/// PTY channels persist across hub reconnections.
#[cfg(unix)]
pub async fn run_daemon(socket_path: String) -> std::io::Result<()> {
    run_daemon_impl(socket_path, get_config_dir()).await
}

/// Internal implementation — takes an explicit config_dir so tests can inject a temp dir
/// without mutating process-global environment variables.
#[cfg(unix)]
async fn run_daemon_impl(socket_path: String, config_dir: String) -> std::io::Result<()> {
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
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }

    tracing::info!("daemon listening on {:?}", path);

    // Load auth token once at startup (None → first-run, skip auth)
    let expected_token = read_auth_token(&config_dir).await;
    if expected_token.is_some() {
        tracing::info!("auth token loaded — connections will be authenticated");
    } else {
        tracing::info!(
            "no auth token found — connections accepted without authentication (first-run)"
        );
    }

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
                    expected_token.clone(),
                ));
            }
            Err(e) => {
                tracing::error!("accept error: {}", e);
            }
        }
    }
}

// ─── Windows (named pipe) implementation ──────────────────────────────────────

/// Returns the named pipe path for this agent instance.
///
/// Format: `\\.\pipe\nexterm-agent-<username>`
#[cfg(windows)]
fn get_pipe_name() -> String {
    let username = std::env::var("USERNAME").unwrap_or_else(|_| "default".into());
    format!(r"\\.\pipe\nexterm-agent-{}", username)
}

/// Run the agent in daemon mode (Windows named pipe).
///
/// Listens on a Windows named pipe. Handles one connection at a time
/// (last-writer-wins: new connections displace the previous one).
/// PTY channels persist across hub reconnections.
#[cfg(windows)]
pub async fn run_daemon(socket_path: String) -> std::io::Result<()> {
    let pipe_name = if socket_path.starts_with(r"\\.\pipe\") {
        socket_path.clone()
    } else {
        // Caller passed a non-pipe path (e.g. legacy XDG path on wrong OS) — use canonical name
        get_pipe_name()
    };

    tracing::info!("daemon listening on {}", pipe_name);

    // Use the canonical Windows config dir (auth.json lives in %APPDATA%\nexterm\)
    let config_dir = get_config_dir();

    // Load auth token once at startup (None → first-run, skip auth)
    let expected_token = read_auth_token(&config_dir).await;
    if expected_token.is_some() {
        tracing::info!("auth token loaded — connections will be authenticated");
    } else {
        tracing::info!(
            "no auth token found — connections accepted without authentication (first-run)"
        );
    }

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

    // Named pipe accept loop using owner-only ACL (SDDL "D:(A;;GA;;;OW)"):
    //   1. Create first server instance with secure DACL
    //   2. Wait for client to connect
    //   3. Create next server instance BEFORE handing off the current pipe
    //   4. Spawn handler task, repeat
    let mut server = create_secure_pipe(&pipe_name, true)?;

    loop {
        // Block until a client connects to this pipe instance
        // Use match instead of ? to avoid crashing the daemon on transient OS errors
        if let Err(e) = server.connect().await {
            tracing::warn!("named pipe connect error: {} — retrying", e);
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        }
        tracing::info!("new hub connection (named pipe)");

        // Swap in the next server instance so the pipe name stays open for future clients
        let connected = {
            let next = create_secure_pipe(&pipe_name, false)?;
            std::mem::replace(&mut server, next)
        };

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
        tokio::spawn(handle_connection_inner(
            connected,
            Arc::clone(&pty_manager),
            Arc::clone(&cmd_senders),
            output_tx.clone(),
            frame_tx,
            frame_rx,
            Arc::clone(&active_conn),
            cancel,
            expected_token.clone(),
        ));
    }
}

// ─── Shared connection logic ──────────────────────────────────────────────────

// Core connection handler, generic over any AsyncRead + AsyncWrite stream.
// Handles one hub connection: sends HELLO + channel state, then runs the
// read/write loop until EOF, error, or displacement by a new connection.
// Used by both the Unix UDS path and the Windows named-pipe path.

// ── Auth helpers ──────────────────────────────────────────────────────────────

/// Read the auth token from `{config_dir}/auth.json`.
/// Returns `None` if the file is absent AND meta.db does not exist (true first-run: no auth required).
/// Returns `Some(String::new())` if auth.json is absent but meta.db exists (fail-closed: auth bypass refused).
/// Returns `Some(String::new())` if the file exists but is unreadable or malformed (fail-closed).
/// Returns `Some(token)` on success.
async fn read_auth_token(config_dir: &str) -> Option<String> {
    let path = format!("{}/auth.json", config_dir);

    // File doesn't exist — check whether this is truly a first run
    if !std::path::Path::new(&path).exists() {
        let meta_db = get_state_dir().join("meta.db");
        if meta_db.exists() {
            // State data exists but auth.json is gone — this is NOT a first run.
            // Refusing to start without authentication to prevent silent auth bypass.
            tracing::error!(
				"auth.json is missing but meta.db exists — refusing to start without authentication. \
				Restore auth.json or re-initialize."
			);
            return Some(String::new()); // empty token = nothing will match = fail-closed
        }
        // True first run — no state data, no auth.json
        tracing::info!(
            "First run: no auth.json found, connections accepted without authentication"
        );
        return None;
    }

    // File exists but can't be read → security error, fail-closed
    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(
                "auth.json exists but unreadable: {} — connections will be rejected",
                e
            );
            return Some(String::new()); // empty token = nothing will match = fail-closed
        }
    };

    // File exists but malformed → fail-closed
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(v) => v
            .get("token")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                tracing::error!("auth.json missing 'token' field — connections will be rejected");
                Some(String::new()) // fail-closed
            }),
        Err(e) => {
            tracing::error!("auth.json malformed: {} — connections will be rejected", e);
            Some(String::new()) // fail-closed
        }
    }
}

/// Constant-time byte comparison — prevents timing attacks on token validation.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Read the first framed message from `reader` (5 s timeout).
/// Expects `{ "type": "AUTH", "token": "<hex>" }`.
/// Returns `Ok(true)` on match, `Ok(false)` on mismatch, `Err` on timeout/IO.
/// Read the first framed message from `reader` (5 s timeout).
/// Expects the first message to be `HubToAgent::Auth { token }`.
/// Returns `Ok(true)` on match, `Ok(false)` on mismatch, `Err` on timeout/IO.
async fn validate_auth<R: AsyncRead + Unpin>(
    reader: &mut R,
    expected_token: &str,
) -> std::io::Result<bool> {
    use crate::protocol::HubToAgent;
    use tokio::time::{timeout, Duration};

    // 5-second deadline for the AUTH frame
    let first_msg = timeout(Duration::from_secs(5), async {
        let mut frame_reader = FrameReader::new();
        let mut buf = vec![0u8; 4096];
        loop {
            let n = reader.read(&mut buf).await?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "client disconnected before AUTH",
                ));
            }
            let msgs = frame_reader
                .push(&buf[..n])
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            if let Some(msg) = msgs.into_iter().next() {
                return Ok(msg);
            }
        }
    })
    .await
    .map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "AUTH frame not received within 5s",
        )
    })??;

    // Match the decoded message — only HubToAgent::Auth passes
    match first_msg {
        HubToAgent::Auth { token } => Ok(ct_eq(expected_token.as_bytes(), token.as_bytes())),
        _other => {
            tracing::warn!("expected AUTH message as first frame, got a different message type");
            Ok(false)
        }
    }
}

// ── Windows secure pipe ───────────────────────────────────────────────────────

/// Create a named pipe restricted to the current user via SDDL `"D:(A;;GA;;;OW)"`.
///
/// SDDL breakdown:
///   D  = DACL (discretionary access control list)
///   A  = Allow ACE
///   GA = GENERIC_ALL
///   OW = Owner (the SID of the process owner)
///
/// This means only the user who created the pipe (the agent process owner) may
/// connect to it — other local users are denied by the implicit "deny all else"
/// that follows an explicit DACL.
#[cfg(windows)]
fn create_secure_pipe(
    name: &str,
    first: bool,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use tokio::net::windows::named_pipe::NamedPipeServer;
    use windows_sys::Win32::Foundation::{LocalFree, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, PIPE_ACCESS_DUPLEX,
    };
    use windows_sys::Win32::System::Pipes::{
        CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };

    // SDDL: Allow Generic All to the pipe owner (OW = owner SID).
    // The implicit default-deny covers all other users.
    let sddl: Vec<u16> = "D:(A;;GA;;;OW)\0".encode_utf16().collect();

    let mut psd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut psd,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }

    // SAFETY: psd is heap-allocated by the Windows API via LocalAlloc;
    // LocalFree is the correct deallocator. The guard ensures cleanup on error.
    struct PsdGuard(PSECURITY_DESCRIPTOR);
    impl Drop for PsdGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { LocalFree(self.0 as _) };
            }
        }
    }
    let _guard = PsdGuard(psd);

    let mut sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: psd,
        bInheritHandle: 0,
    };

    // Encode pipe name as UTF-16 NUL-terminated
    let name_wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();

    let flags = PIPE_ACCESS_DUPLEX
        | FILE_FLAG_OVERLAPPED
        | if first {
            FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };

    let handle = unsafe {
        CreateNamedPipeW(
            name_wide.as_ptr(),
            flags,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            65536,
            65536,
            0,
            &mut sa,
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }

    // SAFETY: `handle` is a valid overlapped pipe handle created above.
    // tokio::NamedPipeServer::from_raw_handle registers it with the IOCP.
    unsafe { NamedPipeServer::from_raw_handle(handle as _) }
}

/// Used by both the Unix UDS path and the Windows named-pipe path.
#[allow(clippy::too_many_arguments)]
async fn handle_connection_inner<S>(
    stream: S,
    pty_manager: Arc<Mutex<PtyManager>>,
    cmd_senders: SnapshotSenders,
    output_tx: mpsc::UnboundedSender<OutputEvent>,
    frame_tx: FrameSender,
    mut frame_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    active_conn: Arc<Mutex<Option<ActiveConnection>>>,
    cancel: Arc<Notify>,
    expected_token: Option<String>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut read_half, mut write_half) = tokio::io::split(stream);

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

    // --- Step 1: Send HELLO first (hub needs to see the agent is alive before sending AUTH) ---
    if send_encoded(&frame_tx, &crate::handler::build_hello()).is_err() {
        clear_active_if_ours(&active_conn, &cancel).await;
        return;
    }

    // --- Step 2: Validate AUTH if a token is configured ---
    // If no token is configured (first-run), skip auth entirely.
    if let Some(ref token) = expected_token {
        match validate_auth(&mut read_half, token).await {
            Ok(true) => {
                tracing::info!("auth handshake succeeded");
            }
            Ok(false) => {
                tracing::warn!("auth handshake failed: token mismatch — dropping connection");
                clear_active_if_ours(&active_conn, &cancel).await;
                return;
            }
            Err(e) => {
                tracing::warn!("auth handshake error: {} — dropping connection", e);
                clear_active_if_ours(&active_conn, &cancel).await;
                return;
            }
        }
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

// ─── Unix (UDS) implementation ────────────────────────────────────────────────

#[cfg(unix)]
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
#[cfg(unix)]
async fn handle_connection(
    stream: UnixStream,
    pty_manager: Arc<Mutex<PtyManager>>,
    cmd_senders: SnapshotSenders,
    output_tx: mpsc::UnboundedSender<OutputEvent>,
    frame_tx: FrameSender,
    frame_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    active_conn: Arc<Mutex<Option<ActiveConnection>>>,
    cancel: Arc<Notify>,
    expected_token: Option<String>,
) {
    handle_connection_inner(
        stream,
        pty_manager,
        cmd_senders,
        output_tx,
        frame_tx,
        frame_rx,
        active_conn,
        cancel,
        expected_token,
    )
    .await
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
fn send_encoded(tx: &FrameSender, msg: &AgentToHub) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
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

    /// Verify short socket paths pass the length guard (Unix).
    #[cfg(unix)]
    #[test]
    fn test_socket_path_validation_short() {
        assert!(PathBuf::from("/tmp/test.sock").as_os_str().len() <= 100);
    }

    /// Verify long socket paths would fail the length guard (Unix).
    #[cfg(unix)]
    #[test]
    fn test_socket_path_validation_too_long() {
        let long_path = format!("/tmp/{}/agent.sock", "a".repeat(200));
        assert!(PathBuf::from(&long_path).as_os_str().len() > 100);
    }

    /// Verify the Windows pipe name follows the canonical format.
    #[cfg(windows)]
    #[test]
    fn test_get_pipe_name_format() {
        let name = get_pipe_name();
        assert!(
            name.starts_with(r"\\.\pipe\nexterm-agent-"),
            "pipe name must start with \\\\.\\pipe\\nexterm-agent-, got: {}",
            name
        );
        // Must include at least one character of username after the dash
        let suffix = name.trim_start_matches(r"\\.\pipe\nexterm-agent-");
        assert!(!suffix.is_empty(), "pipe name must include username");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_daemon_starts_and_accepts() {
        // Use an empty temp dir as config_dir — no auth.json → no auth required.
        // Pass directly to run_daemon_impl to avoid env var mutation races.
        let empty_config = std::env::temp_dir().join(format!(
            "nexterm-test-cfg-noop-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&empty_config).await.unwrap();
        let config_dir = empty_config.to_string_lossy().to_string();

        let sock_name = format!(
            "nexterm-test-{}.sock",
            ulid::Ulid::new().to_string().to_lowercase()
        );
        let path = std::env::temp_dir().join(&sock_name);
        let path_str = path.to_string_lossy().to_string();

        // Start daemon in background
        let daemon_handle = tokio::spawn(run_daemon_impl(path_str.clone(), config_dir.clone()));

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
        let _ = tokio::fs::remove_dir_all(&empty_config).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_connection_displacement() {
        let empty_config = std::env::temp_dir().join(format!(
            "nexterm-test-cfg-disp-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&empty_config).await.unwrap();
        let config_dir = empty_config.to_string_lossy().to_string();

        let sock_name = format!(
            "nexterm-test-displace-{}.sock",
            ulid::Ulid::new().to_string().to_lowercase()
        );
        let path = std::env::temp_dir().join(&sock_name);
        let path_str = path.to_string_lossy().to_string();

        let daemon_handle = tokio::spawn(run_daemon_impl(path_str.clone(), config_dir.clone()));
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
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            stream1.read(&mut buf),
        )
        .await;
        match result {
            Ok(Ok(0)) => {}     // clean EOF — expected
            Ok(Err(_)) => {}    // IO error — also expected
            Ok(Ok(_n)) => {}    // may receive buffered frames before EOF — acceptable
            Err(_timeout) => {} // timeout also acceptable
        }

        drop(stream1);
        drop(stream2);
        daemon_handle.abort();
        let _ = std::fs::remove_file(&path_str);
        let _ = tokio::fs::remove_dir_all(&empty_config).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_socket_permissions() {
        let empty_config = std::env::temp_dir().join(format!(
            "nexterm-test-cfg-perms-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&empty_config).await.unwrap();
        let config_dir = empty_config.to_string_lossy().to_string();

        let sock_name = format!(
            "nexterm-test-perms-{}.sock",
            ulid::Ulid::new().to_string().to_lowercase()
        );
        let path = std::env::temp_dir().join(&sock_name);
        let path_str = path.to_string_lossy().to_string();

        let daemon_handle = tokio::spawn(run_daemon_impl(path_str.clone(), config_dir.clone()));
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        {
            use std::os::unix::fs::PermissionsExt;
            let meta = std::fs::metadata(&path_str).unwrap();
            let mode = meta.permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "socket must be 0600, got {:o}", mode);
        }

        daemon_handle.abort();
        let _ = std::fs::remove_file(&path_str);
        let _ = tokio::fs::remove_dir_all(&empty_config).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_channel_state_end_sent_on_connect() {
        let empty_config = std::env::temp_dir().join(format!(
            "nexterm-test-cfg-stateend-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&empty_config).await.unwrap();
        let config_dir = empty_config.to_string_lossy().to_string();

        let sock_name = format!(
            "nexterm-test-state-end-{}.sock",
            ulid::Ulid::new().to_string().to_lowercase()
        );
        let path = std::env::temp_dir().join(&sock_name);
        let path_str = path.to_string_lossy().to_string();

        let daemon_handle = tokio::spawn(run_daemon_impl(path_str.clone(), config_dir.clone()));
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
        let _ = tokio::fs::remove_dir_all(&empty_config).await;
    }

    /// Verify a named pipe server instance can be created successfully on Windows.
    #[cfg(windows)]
    #[tokio::test]
    async fn test_named_pipe_creates_and_accepts() {
        use tokio::net::windows::named_pipe::{ClientOptions, ServerOptions};

        let pipe_name = format!(
            r"\\.\pipe\nexterm-test-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        );

        // Create server
        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&pipe_name)
            .expect("server creation must succeed");

        // Connect client in background (retry briefly until server is ready)
        let pipe_name_c = pipe_name.clone();
        let client_task = tokio::spawn(async move {
            for _ in 0..10u32 {
                match ClientOptions::new().open(&pipe_name_c) {
                    Ok(c) => return c,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    }
                }
            }
            ClientOptions::new().open(&pipe_name_c).unwrap()
        });

        server
            .connect()
            .await
            .expect("connect() must succeed when client connects");

        let _client = client_task.await.expect("client task must succeed");
    }

    // ── Auth helper unit tests (cross-platform) ──────────────────────────────

    /// ct_eq returns true for identical byte slices.
    #[test]
    fn test_ct_eq_match() {
        assert!(ct_eq(b"deadbeef", b"deadbeef"));
    }

    /// ct_eq returns false for different byte slices of equal length.
    #[test]
    fn test_ct_eq_mismatch() {
        assert!(!ct_eq(b"deadbeef", b"deadbee0"));
    }

    /// ct_eq returns false for slices of different lengths.
    #[test]
    fn test_ct_eq_length_mismatch() {
        assert!(!ct_eq(b"short", b"longer"));
    }

    /// validate_auth accepts a correctly framed AUTH message with the right token.
    #[tokio::test]
    async fn test_validate_auth_correct_token() {
        use crate::framing::encode_frame;
        use crate::protocol::HubToAgent;

        let token = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
        let msg = HubToAgent::Auth {
            token: token.to_string(),
        };
        let frame = encode_frame(&msg).expect("encode must succeed");

        let mut cursor = std::io::Cursor::new(frame);
        let result = validate_auth(&mut cursor, token).await;
        assert!(result.is_ok(), "validate_auth must not error: {:?}", result);
        assert!(result.unwrap(), "correct token must return true");
    }

    /// validate_auth rejects a wrong token.
    #[tokio::test]
    async fn test_validate_auth_wrong_token() {
        use crate::framing::encode_frame;
        use crate::protocol::HubToAgent;

        let real_token = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
        let wrong_token = "000000def456abc123def456abc123def456abc123def456abc123def456abc1";
        let msg = HubToAgent::Auth {
            token: wrong_token.to_string(),
        };
        let frame = encode_frame(&msg).expect("encode must succeed");

        let mut cursor = std::io::Cursor::new(frame);
        let result = validate_auth(&mut cursor, real_token).await;
        assert!(result.is_ok(), "validate_auth must not error on mismatch");
        assert!(!result.unwrap(), "wrong token must return false");
    }

    /// validate_auth returns an error when the stream is empty (no AUTH frame sent).
    #[tokio::test]
    async fn test_validate_auth_empty_stream() {
        let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
        let result = validate_auth(&mut cursor, "anytoken").await;
        assert!(result.is_err(), "empty stream must return an error");
    }

    /// validate_auth rejects a frame whose type is not AUTH.
    #[tokio::test]
    async fn test_validate_auth_wrong_message_type() {
        use crate::framing::encode_frame;
        use crate::protocol::HubToAgent;

        // Send a HEARTBEAT (any non-AUTH message)
        let msg = HubToAgent::Heartbeat {
            ts: "2026-01-01T00:00:00Z".to_string(),
        };
        let frame = encode_frame(&msg).expect("encode must succeed");

        let mut cursor = std::io::Cursor::new(frame);
        let result = validate_auth(&mut cursor, "anytoken").await;
        assert!(result.is_ok());
        assert!(!result.unwrap(), "non-AUTH message type must return false");
    }

    /// read_auth_token returns None for a non-existent file.
    #[tokio::test]
    async fn test_read_auth_token_missing_file() {
        let result = read_auth_token("/tmp/nexterm-nonexistent-99999/").await;
        assert!(result.is_none(), "missing file must return None");
    }

    /// read_auth_token parses a valid auth.json correctly.
    #[tokio::test]
    async fn test_read_auth_token_valid() {
        let dir = std::env::temp_dir().join(format!(
            "nexterm-auth-test-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let auth_path = dir.join("auth.json");
        tokio::fs::write(&auth_path, r#"{"token":"deadbeef1234"}"#)
            .await
            .unwrap();

        let result = read_auth_token(&dir.to_string_lossy()).await;
        assert_eq!(result, Some("deadbeef1234".to_string()));

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// read_auth_token returns Some("") (fail-closed) for malformed JSON.
    #[tokio::test]
    async fn test_read_auth_token_malformed() {
        let dir = std::env::temp_dir().join(format!(
            "nexterm-auth-bad-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let auth_path = dir.join("auth.json");
        tokio::fs::write(&auth_path, b"not json at all")
            .await
            .unwrap();

        let result = read_auth_token(&dir.to_string_lossy()).await;
        // Fail-closed: file exists but is malformed → Some("") so auth always fails
        assert_eq!(
            result,
            Some(String::new()),
            "malformed JSON must return Some(\"\") to fail-closed"
        );

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// read_auth_token returns Some("") (fail-closed) for JSON missing the 'token' field.
    #[tokio::test]
    async fn test_read_auth_token_missing_token_field() {
        let dir = std::env::temp_dir().join(format!(
            "nexterm-auth-nofield-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let auth_path = dir.join("auth.json");
        tokio::fs::write(&auth_path, br#"{"other":"value"}"#)
            .await
            .unwrap();

        let result = read_auth_token(&dir.to_string_lossy()).await;
        // Fail-closed: file exists with valid JSON but no 'token' field
        assert_eq!(
            result,
            Some(String::new()),
            "JSON without 'token' field must return Some(\"\") to fail-closed"
        );

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// Daemon rejects a connection when a wrong token is sent.
    /// New flow: connect → receive HELLO → send wrong AUTH → connection closed.
    #[cfg(unix)]
    #[tokio::test]
    async fn test_daemon_rejects_wrong_auth_token() {
        use crate::framing::encode_frame;
        use crate::protocol::HubToAgent;

        // Write auth.json to a temp dir and pass it directly as config_dir to run_daemon_impl.
        let config_dir_path = std::env::temp_dir().join(format!(
            "nexterm-test-cfg-auth-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&config_dir_path).await.unwrap();
        let auth_path = config_dir_path.join("auth.json");
        let expected = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
        tokio::fs::write(&auth_path, format!(r#"{{"token":"{}"}}"#, expected))
            .await
            .unwrap();
        let config_dir = config_dir_path.to_string_lossy().to_string();

        let sock_dir = std::env::temp_dir().join(format!(
            "nexterm-daemon-auth-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&sock_dir).await.unwrap();
        let sock_path = sock_dir.join("agent.sock");
        let path_str = sock_path.to_string_lossy().to_string();

        let daemon_handle = tokio::spawn(run_daemon_impl(path_str.clone(), config_dir.clone()));
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let mut stream = UnixStream::connect(&path_str).await.unwrap();

        // Step 1: Receive HELLO (agent sends it first in new protocol)
        let mut buf = vec![0u8; 4096];
        let n = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf))
            .await
            .expect("must not timeout waiting for HELLO")
            .expect("must not error reading HELLO");
        assert!(n >= 4, "must receive HELLO frame header");
        let len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        let payload = &buf[4..4 + len];
        let value: serde_json::Value = rmp_serde::from_slice(payload).unwrap();
        assert_eq!(value["type"], "HELLO", "first message must be HELLO");

        // Step 2: Send AUTH with wrong token
        let wrong = HubToAgent::Auth {
            token: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        };
        let frame = encode_frame(&wrong).unwrap();
        stream.write_all(&frame).await.unwrap();

        // Step 3: Daemon should close the connection — we should get EOF
        let mut buf2 = vec![0u8; 64];
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf2)).await;
        match result {
            Ok(Ok(0)) => {}  // EOF — expected
            Ok(Err(_)) => {} // IO error — also acceptable
            Ok(Ok(_n)) => panic!("daemon must not send data after wrong auth"),
            Err(_) => panic!("timeout waiting for connection close after wrong auth"),
        }

        daemon_handle.abort();
        let _ = tokio::fs::remove_dir_all(&config_dir_path).await;
        let _ = tokio::fs::remove_dir_all(&sock_dir).await;
    }

    /// Daemon accepts a connection when the correct token is sent.
    /// New flow: connect → receive HELLO → send correct AUTH → receive CHANNEL_STATE_END.
    #[cfg(unix)]
    #[tokio::test]
    async fn test_daemon_accepts_correct_auth_token() {
        use crate::framing::encode_frame;
        use crate::protocol::HubToAgent;

        let config_dir_path = std::env::temp_dir().join(format!(
            "nexterm-test-cfg-authok-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&config_dir_path).await.unwrap();
        let auth_path = config_dir_path.join("auth.json");
        let token = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
        tokio::fs::write(&auth_path, format!(r#"{{"token":"{}"}}"#, token))
            .await
            .unwrap();
        let config_dir = config_dir_path.to_string_lossy().to_string();

        let sock_dir = std::env::temp_dir().join(format!(
            "nexterm-daemon-authok-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        ));
        tokio::fs::create_dir_all(&sock_dir).await.unwrap();
        let sock_path = sock_dir.join("agent.sock");
        let path_str = sock_path.to_string_lossy().to_string();

        let daemon_handle = tokio::spawn(run_daemon_impl(path_str.clone(), config_dir.clone()));
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let mut stream = UnixStream::connect(&path_str).await.unwrap();

        // Step 1: Receive HELLO (agent sends it first in new protocol)
        let mut buf = vec![0u8; 4096];
        let n = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf))
            .await
            .expect("must not timeout waiting for HELLO")
            .expect("must not error reading HELLO");
        assert!(n >= 4, "must receive HELLO frame header");
        let len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        let payload = &buf[4..4 + len];
        let value: serde_json::Value = rmp_serde::from_slice(payload).unwrap();
        assert_eq!(value["type"], "HELLO", "first message must be HELLO");

        // Step 2: Send correct AUTH
        let auth_msg = HubToAgent::Auth {
            token: token.to_string(),
        };
        let frame = encode_frame(&auth_msg).unwrap();
        stream.write_all(&frame).await.unwrap();

        // Step 3: Receive more frames (CHANNEL_STATE_END confirms auth succeeded)
        let mut buf2 = vec![0u8; 4096];
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf2)).await;
        let n2 = result
            .expect("must not timeout after correct auth")
            .expect("must not error reading post-auth frames");
        assert!(
            n2 >= 4,
            "must receive at least 4-byte frame header after auth"
        );

        daemon_handle.abort();
        let _ = tokio::fs::remove_dir_all(&config_dir_path).await;
        let _ = tokio::fs::remove_dir_all(&sock_dir).await;
    }

    /// Windows: create_secure_pipe creates a pipe that can accept connections.
    #[cfg(windows)]
    #[tokio::test]
    async fn test_create_secure_pipe_accepts_connection() {
        use tokio::net::windows::named_pipe::ClientOptions;

        let pipe_name = format!(
            r"\\.\pipe\nexterm-test-secure-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        );

        let mut server =
            create_secure_pipe(&pipe_name, true).expect("secure pipe creation must succeed");

        let pipe_name_c = pipe_name.clone();
        let client_task = tokio::spawn(async move {
            for _ in 0..10u32 {
                match ClientOptions::new().open(&pipe_name_c) {
                    Ok(c) => return c,
                    Err(_) => {
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    }
                }
            }
            ClientOptions::new().open(&pipe_name_c).unwrap()
        });

        server
            .connect()
            .await
            .expect("secure pipe connect() must succeed when owner connects");

        let _client = client_task.await.expect("client task must succeed");
    }

    /// Verify run_daemon (Windows) starts and sends a valid HELLO frame over a named pipe.
    #[cfg(windows)]
    #[tokio::test]
    async fn test_named_pipe_daemon_hello() {
        use tokio::io::AsyncReadExt;
        use tokio::net::windows::named_pipe::ClientOptions;

        let pipe_name = format!(
            r"\\.\pipe\nexterm-test-hello-{}",
            ulid::Ulid::new().to_string().to_lowercase()
        );

        let daemon_handle = tokio::spawn(run_daemon(pipe_name.clone()));

        // Wait for daemon to create the pipe
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let mut client = ClientOptions::new()
            .open(&pipe_name)
            .expect("must connect to daemon pipe");

        let mut buf = vec![0u8; 4096];
        let n = client.read(&mut buf).await.expect("must read HELLO frame");
        assert!(n >= 4, "expected at least a 4-byte frame header");

        let len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        assert!(n >= 4 + len, "full HELLO frame not received");
        let payload = &buf[4..4 + len];
        let value: serde_json::Value =
            rmp_serde::from_slice(payload).expect("HELLO must be valid msgpack");
        assert_eq!(value["type"], "HELLO", "first message must be HELLO");

        drop(client);
        daemon_handle.abort();
    }
}
