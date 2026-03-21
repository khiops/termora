use std::collections::HashMap;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::batch::{batch_loop, BatchedOutput, OutputEvent};
use crate::expand::expand_vars;
use crate::framing::{encode_frame, FrameReader};
use crate::headless::{HeadlessMirror, SnapshotInfo};
use crate::protocol::{error_codes, AgentToHub, SnapshotData};
use crate::pty::PtyManager;
use crate::shell;
use async_xpty::PtySize;

/// Commands sent from the main task to a per-channel PTY reader task.
pub(crate) enum ChannelCommand {
    /// Request a snapshot; reply is sent on the oneshot channel.
    Snapshot(oneshot::Sender<SnapshotInfo>),
    /// Notify the mirror of a resize.
    Resize(u16, u16),
}

/// Per-channel sender for ChannelCommand.
/// Frame sender — encodes messages to bytes, delivers to writer task.
/// Using a channel as the write abstraction allows sharing across stdio and daemon modes.
pub(crate) type FrameSender = mpsc::UnboundedSender<Vec<u8>>;

/// Per-channel sender for ChannelCommand.
pub(crate) type SnapshotSenders =
    Arc<Mutex<HashMap<String, mpsc::UnboundedSender<ChannelCommand>>>>;

/// Run the agent in stdio mode (stdin/stdout MessagePack framing).
/// Run the agent in stdio mode (stdin/stdout MessagePack framing).
pub async fn run_stdio() -> std::io::Result<()> {
    // 1. Build a FrameSender — frames go to a channel, writer task drains to stdout
    let stdout_raw = tokio::io::stdout();
    let stdout = Arc::new(Mutex::new(stdout_raw));
    let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // 2. Spawn stdout writer task
    {
        let stdout_w = Arc::clone(&stdout);
        tokio::spawn(async move {
            while let Some(frame) = frame_rx.recv().await {
                let mut w = stdout_w.lock().await;
                let _ = w.write_all(&frame).await;
                let _ = w.flush().await;
            }
        });
    }

    // 3. Send HELLO
    send_frame(&frame_tx, &build_hello())?;

    // 4. Shared state
    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));

    // 5. Per-channel command senders (for snapshot requests and resize forwarding)
    let cmd_senders: SnapshotSenders = Arc::new(Mutex::new(HashMap::new()));

    // 6. Batch channels
    let (output_tx, output_rx) = mpsc::unbounded_channel::<OutputEvent>();
    let (batched_tx, mut batched_rx) = mpsc::unbounded_channel::<BatchedOutput>();

    // 7. Spawn batch loop
    tokio::spawn(batch_loop(output_rx, batched_tx));

    // 8. Spawn batched output writer
    {
        let ftx = frame_tx.clone();
        tokio::spawn(async move {
            while let Some(b) = batched_rx.recv().await {
                let msg = AgentToHub::Output {
                    channel_id: b.channel_id,
                    seq: b.seq,
                    ts: iso_now(),
                    data: b.data,
                };
                if let Ok(frame) = encode_frame(&msg) {
                    let _ = ftx.send(frame);
                }
            }
        });
    }

    // 9. stdin read loop
    let mut stdin = tokio::io::stdin();
    let mut reader = FrameReader::new();
    let mut buf = vec![0u8; 8192];

    loop {
        let n = stdin.read(&mut buf).await?;
        if n == 0 {
            tracing::info!("stdin EOF, shutting down");
            break;
        }
        let messages = reader.push(&buf[..n])?;
        for msg in messages {
            handle_message(
                msg,
                Arc::clone(&pty_manager),
                frame_tx.clone(),
                output_tx.clone(),
                Arc::clone(&cmd_senders),
            )
            .await?;
        }
    }

    // Shutdown: kill all channels
    pty_manager.lock().await.destroy_all().await;

    // Shutdown: clean up any leftover ASKPASS temp files
    crate::elevation::cleanup_all();

    Ok(())
}

/// Build the HELLO message sent to the hub at connection start.
pub(crate) fn build_hello() -> AgentToHub {
    AgentToHub::Hello {
        version: 1,
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
        capabilities: vec![
            "multiplex".into(),
            "resize".into(),
            "snapshot".into(),
            "launch-profiles".into(),
        ],
        available_shells: Some(shell::detect_available_shells()),
        default_shell: Some(shell::get_default_shell()),
    }
}

/// Dispatch a single message from the hub.
/// Dispatch a single message from the hub.
pub(crate) async fn handle_message(
    msg: crate::protocol::HubToAgent,
    pty_manager: Arc<Mutex<PtyManager>>,
    frame_tx: FrameSender,
    output_tx: mpsc::UnboundedSender<OutputEvent>,
    cmd_senders: SnapshotSenders,
) -> std::io::Result<()> {
    use crate::protocol::HubToAgent;

    match msg {
        HubToAgent::Heartbeat { ts } => {
            send_frame(&frame_tx, &AgentToHub::HeartbeatAck { ts })?;
        }

        HubToAgent::Spawn {
            request_id,
            channel_id,
            shell,
            args,
            cwd,
            env,
            cols,
            rows,
            elevated,
            elevation_secret,
            elevation_method,
            custom_command,
            ..
        } => {
            handle_spawn(
                request_id,
                channel_id,
                shell,
                args.unwrap_or_default(),
                cwd,
                env,
                cols,
                rows,
                elevated,
                elevation_secret,
                elevation_method,
                custom_command,
                pty_manager,
                frame_tx,
                output_tx,
                cmd_senders,
            )
            .await?;
        }

        HubToAgent::Input { channel_id, data } => {
            // Get writer before dropping lock to avoid holding across await
            let writer_opt = {
                let mgr = pty_manager.lock().await;
                mgr.channels.get(&channel_id).map(|ch| ch.process.writer())
            };
            if let Some(mut writer) = writer_opt {
                writer.write_all(&data).await?;
            } else {
                send_frame(
                    &frame_tx,
                    &AgentToHub::Error {
                        code: error_codes::CHANNEL_NOT_FOUND.into(),
                        message: format!("channel {} not found", channel_id),
                        channel_id: Some(channel_id),
                    },
                )?;
            }
        }

        HubToAgent::Resize {
            channel_id,
            cols,
            rows,
        } => {
            // Resize the PTY process
            let size = PtySize { cols, rows };
            {
                let mgr = pty_manager.lock().await;
                if let Some(ch) = mgr.channels.get(&channel_id) {
                    let _ = ch.process.resize(size).await;
                } else {
                    send_frame(
                        &frame_tx,
                        &AgentToHub::Error {
                            code: error_codes::CHANNEL_NOT_FOUND.into(),
                            message: format!("channel {} not found", channel_id),
                            channel_id: Some(channel_id.clone()),
                        },
                    )?;
                }
            }
            // Also notify the mirror in the reader task
            let tx_opt = {
                let senders = cmd_senders.lock().await;
                senders.get(&channel_id).cloned()
            };
            if let Some(tx) = tx_opt {
                let _ = tx.send(ChannelCommand::Resize(cols, rows));
            }
        }

        HubToAgent::Destroy { channel_id } => {
            let mut mgr = pty_manager.lock().await;
            if let Some(ch) = mgr.remove(&channel_id) {
                let _ = ch.process.kill();
                tracing::info!("destroyed channel: {}", channel_id);
            }
            // Idempotent: no error if channel doesn't exist
        }

        HubToAgent::SnapshotReq { channel_id } => {
            let tx_opt = {
                let senders = cmd_senders.lock().await;
                senders.get(&channel_id).cloned()
            };
            if let Some(tx) = tx_opt {
                let (reply_tx, reply_rx) = oneshot::channel::<SnapshotInfo>();
                if tx.send(ChannelCommand::Snapshot(reply_tx)).is_ok() {
                    if let Ok(info) = reply_rx.await {
                        // Get the current seq from the pty_manager
                        let last_seq = {
                            let mgr = pty_manager.lock().await;
                            mgr.channels.get(&channel_id).map(|ch| ch.seq).unwrap_or(0)
                        };
                        let msg = AgentToHub::SnapshotRes {
                            channel_id: channel_id.clone(),
                            snapshot: SnapshotData {
                                serialized: info.serialized,
                                cols: info.cols,
                                rows: info.rows,
                                cursor_x: info.cursor_x,
                                cursor_y: info.cursor_y,
                            },
                            last_seq,
                        };
                        send_frame(&frame_tx, &msg)?;
                    } else {
                        tracing::warn!(
                            "SNAPSHOT_REQ: reader task dropped reply sender for channel: {}",
                            channel_id
                        );
                    }
                } else {
                    tracing::warn!("SNAPSHOT_REQ: reader task gone for channel: {}", channel_id);
                }
            } else {
                tracing::warn!("SNAPSHOT_REQ for unknown channel: {}", channel_id);
            }
        }

        HubToAgent::Attach { channel_id } => {
            let tx_opt = {
                let senders = cmd_senders.lock().await;
                senders.get(&channel_id).cloned()
            };
            if let Some(tx) = tx_opt {
                let (reply_tx, reply_rx) = oneshot::channel::<SnapshotInfo>();
                if tx.send(ChannelCommand::Snapshot(reply_tx)).is_ok() {
                    if let Ok(info) = reply_rx.await {
                        let last_seq = {
                            let mgr = pty_manager.lock().await;
                            mgr.channels.get(&channel_id).map(|ch| ch.seq).unwrap_or(0)
                        };
                        let msg = AgentToHub::AttachOk {
                            channel_id: channel_id.clone(),
                            snapshot: SnapshotData {
                                serialized: info.serialized,
                                cols: info.cols,
                                rows: info.rows,
                                cursor_x: info.cursor_x,
                                cursor_y: info.cursor_y,
                            },
                            last_seq,
                        };
                        send_frame(&frame_tx, &msg)?;
                    } else {
                        tracing::warn!(
                            "ATTACH: reader task dropped reply sender for channel: {}",
                            channel_id
                        );
                    }
                } else {
                    tracing::warn!("ATTACH: reader task gone for channel: {}", channel_id);
                    send_frame(
                        &frame_tx,
                        &AgentToHub::Error {
                            code: error_codes::CHANNEL_NOT_FOUND.into(),
                            message: format!("channel {} not found or dead", channel_id),
                            channel_id: Some(channel_id),
                        },
                    )?;
                }
            } else {
                tracing::warn!("ATTACH for unknown channel: {}", channel_id);
                send_frame(
                    &frame_tx,
                    &AgentToHub::Error {
                        code: error_codes::CHANNEL_NOT_FOUND.into(),
                        message: format!("channel {} not found", channel_id),
                        channel_id: Some(channel_id),
                    },
                )?;
            }
        }

        HubToAgent::Error {
            code,
            message,
            channel_id,
        } => {
            if code == error_codes::INVALID_MESSAGE {
                // Unknown message type from FrameReader → send ERROR back to hub
                send_frame(
                    &frame_tx,
                    &AgentToHub::Error {
                        code,
                        message,
                        channel_id,
                    },
                )?;
            } else {
                tracing::warn!("received ERROR from hub: {} — {}", code, message);
            }
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn handle_spawn(
    request_id: String,
    channel_id: Option<String>,
    shell: Option<String>,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    cols: u16,
    rows: u16,
    elevated: Option<bool>,
    elevation_secret: Option<String>,
    elevation_method: Option<String>,
    custom_command: Option<String>,
    pty_manager: Arc<Mutex<PtyManager>>,
    frame_tx: FrameSender,
    output_tx: mpsc::UnboundedSender<OutputEvent>,
    cmd_senders: SnapshotSenders,
) -> std::io::Result<()> {
    let resolved_shell = shell.unwrap_or_else(shell::get_default_shell);

    // Expand vars in args, cwd, env values (NOT shell)
    let expanded_args: Vec<String> = args.iter().map(|a| expand_vars(a, env.as_ref())).collect();
    let expanded_cwd: Option<String> = cwd.map(|d| expand_vars(&d, env.as_ref()));
    let expanded_env: Option<std::collections::HashMap<String, String>> = env.map(|e| {
        e.into_iter()
            .map(|(k, v)| (k, expand_vars(&v, None)))
            .collect()
    });

    // Determine effective program + args (may be wrapped by elevation)
    let (effective_program, effective_args, extra_env, cleanup_path) = if elevated.unwrap_or(false)
    {
        use crate::elevation::{
            register_cleanup, schedule_cleanup, wrap_elevated, ElevationMethod,
        };
        use zeroize::Zeroizing;

        // Determine elevation method
        let method = match elevation_method.as_deref() {
            Some("custom") => match custom_command {
                Some(ref cmd) => ElevationMethod::Custom(cmd.clone()),
                None => {
                    send_frame(
                        &frame_tx,
                        &AgentToHub::SpawnErr {
                            request_id,
                            code: "ELEVATION_CUSTOM_CMD_MISSING".into(),
                            message: "custom elevation method requires custom_command field".into(),
                        },
                    )?;
                    return Ok(());
                }
            },
            Some(s) => ElevationMethod::from_str_method(s)
                .unwrap_or_else(ElevationMethod::platform_default),
            None => ElevationMethod::platform_default(),
        };

        // Immediately wrap secret in Zeroizing — clears on drop
        let secret: Option<Zeroizing<String>> = elevation_secret.map(|s| Zeroizing::new(s));

        match wrap_elevated(&method, &resolved_shell, &expanded_args, secret).await {
            Ok(elevated_cmd) => {
                let cleanup = elevated_cmd.cleanup_path.clone();
                if let Some(ref path) = cleanup {
                    register_cleanup(path);
                    let path_for_cleanup = path.clone();
                    schedule_cleanup(path_for_cleanup, 1000);
                }
                (
                    elevated_cmd.program,
                    elevated_cmd.args,
                    elevated_cmd.env,
                    cleanup,
                )
            }
            Err(e) if e.to_string() == error_codes::ELEVATION_PASSWORD_REQUIRED => {
                send_frame(
                    &frame_tx,
                    &AgentToHub::SpawnErr {
                        request_id,
                        code: error_codes::ELEVATION_PASSWORD_REQUIRED.into(),
                        message: e.to_string(),
                    },
                )?;
                return Ok(());
            }
            Err(e) => {
                send_frame(
                    &frame_tx,
                    &AgentToHub::SpawnErr {
                        request_id,
                        code: "ELEVATION_FAILED".into(),
                        message: e.to_string(),
                    },
                )?;
                return Ok(());
            }
        }
    } else {
        (
            resolved_shell,
            expanded_args,
            std::collections::HashMap::new(),
            None,
        )
    };

    // Merge extra_env (elevation env) into expanded_env
    let merged_env: Option<std::collections::HashMap<String, String>> = if extra_env.is_empty() {
        expanded_env
    } else {
        let mut merged = expanded_env.unwrap_or_default();
        merged.extend(extra_env);
        Some(merged)
    };

    // Suppress unused warning — cleanup_path lifetime is managed by schedule_cleanup
    let _ = cleanup_path;

    let spawn_result = {
        let mut mgr = pty_manager.lock().await;
        mgr.spawn(
            channel_id,
            &effective_program,
            &effective_args,
            expanded_cwd.as_deref(),
            merged_env.as_ref(),
            cols,
            rows,
        )
        .await
    };

    match spawn_result {
        Ok((ch_id, pty_pid)) => {
            // Get a reader for the new channel before releasing the broader context
            let pty_reader_opt = {
                let mgr = pty_manager.lock().await;
                mgr.channels.get(&ch_id).map(|ch| ch.process.reader())
            };

            if let Some(pty_reader) = pty_reader_opt {
                // Create a headless mirror for this channel (not Send — lives in the reader task)
                let mirror = HeadlessMirror::new(cols, rows, 1000);

                // Create per-channel command channel for snapshot/resize
                let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<ChannelCommand>();
                {
                    let mut senders = cmd_senders.lock().await;
                    senders.insert(ch_id.clone(), cmd_tx);
                }

                spawn_reader_task(
                    ch_id.clone(),
                    pty_pid,
                    pty_reader,
                    mirror,
                    cmd_rx,
                    output_tx,
                    frame_tx.clone(),
                    Arc::clone(&pty_manager),
                    Arc::clone(&cmd_senders),
                );
            }

            send_frame(
                &frame_tx,
                &AgentToHub::SpawnOk {
                    request_id,
                    channel_id: ch_id,
                },
            )?;
        }

        Err(e) => {
            let code = map_spawn_error(&e);
            send_frame(
                &frame_tx,
                &AgentToHub::SpawnErr {
                    request_id,
                    code: code.into(),
                    message: e.to_string(),
                },
            )?;
        }
    }

    Ok(())
}

fn spawn_reader_task(
    channel_id: String,
    pty_pid: u32,
    mut pty_reader: async_xpty::PtyReader,
    mirror: HeadlessMirror,
    mut cmd_rx: mpsc::UnboundedReceiver<ChannelCommand>,
    output_tx: mpsc::UnboundedSender<OutputEvent>,
    frame_tx: FrameSender,
    pty_manager: Arc<Mutex<PtyManager>>,
    cmd_senders: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<ChannelCommand>>>>,
) {
    tokio::spawn(async move {
        let mut rbuf = vec![0u8; 4096];
        let mut seq: u64 = 0;
        let mut mirror = mirror;

        // Process title polling state
        let mut poll_interval = tokio::time::interval(std::time::Duration::from_secs(2));
        // Skip the immediate first tick so we don't poll before the shell is ready
        poll_interval.tick().await;
        let mut last_process_title = String::new();

        loop {
            tokio::select! {
                // PTY output
                read_result = pty_reader.read(&mut rbuf) => {
                    match read_result {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            seq += 1;
                            let data = rbuf[..n].to_vec();

                            // Feed output to the headless mirror BEFORE sending to batch
                            mirror.process(&data);

                            // Send to batch loop for OUTPUT frames
                            let _ = output_tx.send(OutputEvent {
                                channel_id: channel_id.clone(),
                                seq,
                                data,
                            });

                            // Emit title change if detected
                            if let Some(title) = mirror.take_title_change() {
                                let msg = AgentToHub::TitleChange {
                                    channel_id: channel_id.clone(),
                                    title,
                                    display_title: None,
                                };
                                if let Ok(frame) = encode_frame(&msg) {
                                    let _ = frame_tx.send(frame);
                                }
                            }

                            // Emit bell if detected
                            if mirror.take_bell() {
                                let msg = AgentToHub::Bell {
                                    channel_id: channel_id.clone(),
                                };
                                if let Ok(frame) = encode_frame(&msg) {
                                    let _ = frame_tx.send(frame);
                                }
                            }

                            // Emit notification if detected
                            if let Some(message) = mirror.take_notification() {
                                let msg = AgentToHub::Notification {
                                    channel_id: channel_id.clone(),
                                    message,
                                };
                                if let Ok(frame) = encode_frame(&msg) {
                                    let _ = frame_tx.send(frame);
                                }
                            }
                        }
                    }
                }

                // Command from main task (snapshot request or resize)
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(ChannelCommand::Snapshot(reply_tx)) => {
                            let info = mirror.snapshot();
                            let _ = reply_tx.send(info);
                        }
                        Some(ChannelCommand::Resize(new_cols, new_rows)) => {
                            mirror.resize(new_cols, new_rows);
                        }
                        None => {
                            // Sender dropped — channel being destroyed
                            break;
                        }
                    }
                }

                // Periodic process title polling
                _ = poll_interval.tick() => {
                    if let Some(title) = crate::process::get_process_title(pty_pid).await {
                        if title != last_process_title {
                            last_process_title = title.clone();
                            let msg = AgentToHub::ProcessTitle {
                                channel_id: channel_id.clone(),
                                title,
                                display_title: None,
                            };
                            if let Ok(frame) = encode_frame(&msg) {
                                let _ = frame_tx.send(frame);
                            }
                        }
                    }
                }
            }
        }

        // PTY EOF: clean up cmd sender entry
        {
            let mut senders = cmd_senders.lock().await;
            senders.remove(&channel_id);
        }

        // PTY EOF: wait for exit status
        let exit_status = {
            let mut mgr = pty_manager.lock().await;
            if let Some(ch) = mgr.channels.get_mut(&channel_id) {
                ch.process.wait().await.ok()
            } else {
                None
            }
        };

        // Remove channel from manager
        {
            let mut mgr = pty_manager.lock().await;
            mgr.remove(&channel_id);
        }

        let (exit_code, signal) = match exit_status {
            Some(s) => (s.code().unwrap_or(-1), s.signal().map(|n| format!("{}", n))),
            None => (-1, None),
        };

        let msg = AgentToHub::ChannelExit {
            channel_id,
            exit_code,
            signal,
        };
        if let Ok(frame) = encode_frame(&msg) {
            let _ = frame_tx.send(frame);
        }
    });
}

/// Map an io::Error from spawn to a protocol error code.
fn map_spawn_error(e: &std::io::Error) -> &'static str {
    match e.kind() {
        std::io::ErrorKind::NotFound => error_codes::SHELL_NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => error_codes::PERMISSION_DENIED,
        std::io::ErrorKind::AlreadyExists => error_codes::CHANNEL_EXISTS,
        _ => error_codes::PTY_SPAWN_FAILED,
    }
}

/// Encode and write a frame to the shared stdout.
/// Encode a message and send it via the frame channel.
/// Synchronous — no await needed. Errors are ignored if receiver is gone.
pub(crate) fn send_frame(tx: &FrameSender, msg: &AgentToHub) -> std::io::Result<()> {
    let frame = encode_frame(msg)?;
    // SendError means receiver dropped — treat as EOF, not a hard error
    let _ = tx.send(frame);
    Ok(())
}

/// Returns current time as ISO 8601 with millisecond precision (UTC).
/// Returns current time as ISO 8601 with millisecond precision (UTC).
pub(crate) fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    let hours = (secs % 86400) / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;
    let (year, month, day) = days_to_ymd(secs / 86400);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

/// Convert days since Unix epoch (1970-01-01) to (year, month, day).
/// Algorithm: http://howardhinnant.github.io/date_algorithms.html
fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
