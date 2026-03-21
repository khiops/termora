/// End-to-end integration tests for nexterm-agent.
///
/// Each test spawns the real binary via `CARGO_BIN_EXE_nexterm-agent`,
/// communicates over stdin/stdout using 4-byte LE length-prefixed MessagePack
/// frames, and verifies correct protocol behavior.
///
/// All reads use `tokio::time::timeout` to prevent test hangs.
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn spawn_agent() -> Child {
    let binary = env!("CARGO_BIN_EXE_nexterm-agent");
    Command::new(binary)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("failed to spawn nexterm-agent binary")
}

/// Read one length-prefixed frame from stdout and decode as `rmpv::Value`.
async fn read_frame(stdout: &mut ChildStdout) -> rmpv::Value {
    let mut len_buf = [0u8; 4];
    stdout
        .read_exact(&mut len_buf)
        .await
        .expect("read length header");
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut payload = vec![0u8; len];
    stdout.read_exact(&mut payload).await.expect("read payload");
    rmp_serde::from_slice(&payload).expect("decode msgpack frame")
}

/// Read one frame with a deadline; panics if the timeout fires.
async fn read_frame_timeout(stdout: &mut ChildStdout, secs: u64) -> rmpv::Value {
    tokio::time::timeout(Duration::from_secs(secs), read_frame(stdout))
        .await
        .expect("read_frame timed out")
}

/// Encode `msg` as a length-prefixed MessagePack frame and write it to stdin.
async fn write_frame(stdin: &mut ChildStdin, msg: &rmpv::Value) {
    let payload = rmp_serde::to_vec_named(msg).expect("encode msgpack frame");
    let len = (payload.len() as u32).to_le_bytes();
    stdin.write_all(&len).await.expect("write length header");
    stdin.write_all(&payload).await.expect("write payload");
    stdin.flush().await.expect("flush stdin");
}

/// Build a `rmpv::Value::Map` from `(&str, rmpv::Value)` pairs.
fn msgmap(pairs: Vec<(&str, rmpv::Value)>) -> rmpv::Value {
    rmpv::Value::Map(
        pairs
            .into_iter()
            .map(|(k, v)| (rmpv::Value::String(k.into()), v))
            .collect(),
    )
}

fn sv(s: &str) -> rmpv::Value {
    rmpv::Value::String(s.into())
}

fn iv(n: i64) -> rmpv::Value {
    rmpv::Value::Integer(n.into())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// SC-09: Agent sends HELLO as the very first frame on stdout.
#[tokio::test]
async fn test_hello_on_startup() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();

    let hello = read_frame_timeout(&mut stdout, 5).await;

    assert_eq!(
        hello["type"].as_str(),
        Some("HELLO"),
        "first frame must be HELLO"
    );
    assert_eq!(hello["version"].as_u64(), Some(1), "version must be 1");
    assert!(
        hello["capabilities"].is_array(),
        "capabilities must be an array"
    );

    agent.kill().await.ok();
}

/// SC-10: HELLO contains shell detection fields (available_shells, default_shell).
#[tokio::test]
async fn test_hello_contains_shells() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();

    let hello = read_frame_timeout(&mut stdout, 5).await;

    let shells = hello["available_shells"]
        .as_array()
        .expect("available_shells must be present in HELLO");
    assert!(!shells.is_empty(), "at least one shell must be detected");

    let default = hello["default_shell"]
        .as_str()
        .expect("default_shell must be present in HELLO");
    assert!(!default.is_empty(), "default_shell must be non-empty");

    agent.kill().await.ok();
}

/// SC-27: HEARTBEAT → HEARTBEAT_ACK; ts field is echoed back verbatim.
#[tokio::test]
async fn test_heartbeat_ack() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let mut stdin = agent.stdin.take().unwrap();

    // Consume HELLO before sending commands.
    let _hello = read_frame_timeout(&mut stdout, 5).await;

    let ts = "2026-03-21T00:00:00Z";
    let hb = msgmap(vec![("type", sv("HEARTBEAT")), ("ts", sv(ts))]);
    write_frame(&mut stdin, &hb).await;

    let ack = read_frame_timeout(&mut stdout, 5).await;
    assert_eq!(ack["type"].as_str(), Some("HEARTBEAT_ACK"));
    assert_eq!(
        ack["ts"].as_str(),
        Some(ts),
        "ts must be echoed back verbatim"
    );

    agent.kill().await.ok();
}

/// SC-11: SPAWN with a valid shell → SPAWN_OK containing a non-empty channel_id.
#[tokio::test]
async fn test_spawn_ok() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let mut stdin = agent.stdin.take().unwrap();

    let _hello = read_frame_timeout(&mut stdout, 5).await;

    let spawn_msg = msgmap(vec![
        ("type", sv("SPAWN")),
        ("request_id", sv("req-1")),
        ("shell", sv("/bin/sh")),
        ("cols", iv(80)),
        ("rows", iv(24)),
    ]);
    write_frame(&mut stdin, &spawn_msg).await;

    let resp = read_frame_timeout(&mut stdout, 5).await;
    assert_eq!(resp["type"].as_str(), Some("SPAWN_OK"));
    assert_eq!(resp["request_id"].as_str(), Some("req-1"));

    let ch_id = resp["channel_id"]
        .as_str()
        .expect("channel_id must be present in SPAWN_OK");
    assert!(!ch_id.is_empty(), "channel_id must be non-empty");

    agent.kill().await.ok();
}

/// SC-13: SPAWN with a nonexistent shell path → SPAWN_ERR with code SHELL_NOT_FOUND.
#[tokio::test]
async fn test_spawn_nonexistent_shell() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let mut stdin = agent.stdin.take().unwrap();

    let _hello = read_frame_timeout(&mut stdout, 5).await;

    let spawn_msg = msgmap(vec![
        ("type", sv("SPAWN")),
        ("request_id", sv("req-2")),
        ("shell", sv("/nonexistent/shell")),
        ("cols", iv(80)),
        ("rows", iv(24)),
    ]);
    write_frame(&mut stdin, &spawn_msg).await;

    let resp = read_frame_timeout(&mut stdout, 5).await;
    assert_eq!(resp["type"].as_str(), Some("SPAWN_ERR"));
    assert_eq!(resp["request_id"].as_str(), Some("req-2"));
    assert_eq!(resp["code"].as_str(), Some("SHELL_NOT_FOUND"));

    agent.kill().await.ok();
}

/// SC-38: Unknown message type → agent sends ERROR INVALID_MESSAGE and continues.
///
/// The FrameReader catches deserialization errors and wraps them as
/// HubToAgent::Error { code: "INVALID_MESSAGE" }, which the handler echoes
/// back to the hub as AgentToHub::Error. The agent does NOT crash.
#[tokio::test]
async fn test_unknown_message_type_sends_error() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let mut stdin = agent.stdin.take().unwrap();

    let _hello = read_frame_timeout(&mut stdout, 5).await;

    // Send an unknown message type
    let unknown = msgmap(vec![
        ("type", sv("UNKNOWN_TYPE_XYZ")),
        ("payload", sv("ignored")),
    ]);
    write_frame(&mut stdin, &unknown).await;

    // Agent should respond with ERROR INVALID_MESSAGE
    let response = read_frame_timeout(&mut stdout, 5).await;
    assert_eq!(response["type"].as_str(), Some("ERROR"));
    assert_eq!(response["code"].as_str(), Some("INVALID_MESSAGE"));

    // Agent is still alive — send heartbeat to confirm
    let hb = msgmap(vec![("type", sv("HEARTBEAT")), ("ts", sv("alive-check"))]);
    write_frame(&mut stdin, &hb).await;
    let ack = read_frame_timeout(&mut stdout, 5).await;
    assert_eq!(ack["type"].as_str(), Some("HEARTBEAT_ACK"));

    agent.kill().await.ok();
}

/// Full lifecycle: SPAWN → read OUTPUT containing expected text → CHANNEL_EXIT.
#[tokio::test]
async fn test_full_lifecycle() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let mut stdin = agent.stdin.take().unwrap();

    let _hello = read_frame_timeout(&mut stdout, 5).await;

    // Spawn a short-lived command that prints a known string then exits.
    let spawn_msg = msgmap(vec![
        ("type", sv("SPAWN")),
        ("request_id", sv("req-lc")),
        ("shell", sv("/bin/sh")),
        (
            "args",
            rmpv::Value::Array(vec![sv("-c"), sv("echo lifecycle_test && exit 0")]),
        ),
        ("cols", iv(80)),
        ("rows", iv(24)),
    ]);
    write_frame(&mut stdin, &spawn_msg).await;

    // Expect SPAWN_OK first.
    let spawn_ok = read_frame_timeout(&mut stdout, 5).await;
    assert_eq!(spawn_ok["type"].as_str(), Some("SPAWN_OK"));
    let ch_id = spawn_ok["channel_id"].as_str().unwrap().to_string();

    // Drain frames until OUTPUT with "lifecycle_test" and CHANNEL_EXIT are seen.
    // IMPORTANT: OUTPUT goes through the 16ms batch loop; CHANNEL_EXIT goes
    // directly via frame_tx. They race — so we must NOT stop reading the moment
    // we see CHANNEL_EXIT. Instead we keep reading for a short grace period after
    // exit so any buffered OUTPUT frames can arrive.
    let mut saw_output = false;
    let mut saw_exit = false;
    // After CHANNEL_EXIT, allow up to 500 ms for any buffered OUTPUT to arrive.
    let mut exit_grace_deadline: Option<tokio::time::Instant> = None;

    loop {
        // Use a short per-frame timeout; tighten it after we've seen exit.
        let per_frame_ms = if exit_grace_deadline.is_some() {
            500
        } else {
            2000
        };
        let frame = match tokio::time::timeout(
            Duration::from_millis(per_frame_ms),
            read_frame(&mut stdout),
        )
        .await
        {
            Ok(f) => f,
            Err(_) => break, // silence — stop draining
        };

        match frame["type"].as_str() {
            Some("OUTPUT") => {
                if let rmpv::Value::Binary(data) = &frame["data"] {
                    if String::from_utf8_lossy(data).contains("lifecycle_test") {
                        saw_output = true;
                    }
                }
            }
            Some("CHANNEL_EXIT") => {
                assert_eq!(
                    frame["channel_id"].as_str(),
                    Some(ch_id.as_str()),
                    "CHANNEL_EXIT channel_id must match the spawned channel"
                );
                saw_exit = true;
                // Keep reading briefly in case buffered OUTPUT hasn't arrived yet.
                exit_grace_deadline =
                    Some(tokio::time::Instant::now() + Duration::from_millis(500));
            }
            _ => {} // TITLE_CHANGE, PROCESS_TITLE, BELL — benign, ignore
        }

        // Stop once we have both, or once the grace period after exit expires.
        if saw_output && saw_exit {
            break;
        }
        if let Some(deadline) = exit_grace_deadline {
            if tokio::time::Instant::now() >= deadline {
                break;
            }
        }
    }

    assert!(
        saw_output,
        "expected OUTPUT frame containing 'lifecycle_test'"
    );
    assert!(saw_exit, "expected CHANNEL_EXIT frame");

    agent.kill().await.ok();
}

/// SC-28: Closing stdin (EOF) causes the agent to exit with code 0 (graceful shutdown).
#[tokio::test]
async fn test_stdin_eof_graceful_shutdown() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let stdin = agent.stdin.take().unwrap();

    let _hello = read_frame_timeout(&mut stdout, 5).await;

    // Close stdin — triggers the `n == 0` branch in run_stdio.
    drop(stdin);

    let status = tokio::time::timeout(Duration::from_secs(5), agent.wait())
        .await
        .expect("agent did not exit within 5 s after stdin EOF")
        .expect("wait() failed");

    assert!(status.success(), "agent must exit with code 0 on stdin EOF");
}

/// Multiple sequential heartbeats are all acknowledged in order with matching ts.
#[tokio::test]
async fn test_multiple_heartbeats_in_order() {
    let mut agent = spawn_agent().await;
    let mut stdout = agent.stdout.take().unwrap();
    let mut stdin = agent.stdin.take().unwrap();

    let _hello = read_frame_timeout(&mut stdout, 5).await;

    for i in 0u32..3 {
        let ts = format!("2026-03-21T00:00:0{i}Z");
        let hb = msgmap(vec![("type", sv("HEARTBEAT")), ("ts", sv(&ts))]);
        write_frame(&mut stdin, &hb).await;

        let ack = read_frame_timeout(&mut stdout, 5).await;
        assert_eq!(
            ack["type"].as_str(),
            Some("HEARTBEAT_ACK"),
            "heartbeat {i} must be acked"
        );
        assert_eq!(
            ack["ts"].as_str(),
            Some(ts.as_str()),
            "ts must match for heartbeat {i}"
        );
    }

    agent.kill().await.ok();
}
