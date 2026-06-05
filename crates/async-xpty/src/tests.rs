//! Integration tests for `async-xpty`.
//!
//! These tests require a Unix environment and `/bin/sh`.

#![cfg(test)]
#![cfg(unix)]

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{CommandBuilder, PtySize};

/// SC-01: Basic PTY spawn returns a valid PID.
#[tokio::test]
async fn test_spawn_pty() {
    let pty = CommandBuilder::new("/bin/sh").spawn().await.unwrap();
    assert!(pty.pid() > 0, "expected non-zero PID");
    pty.kill().ok();
}

/// SC-02: Read PTY output from a one-shot command.
#[tokio::test]
async fn test_read_output() {
    let pty = CommandBuilder::new("/bin/sh")
        .arg("-c")
        .arg("echo hello")
        .spawn()
        .await
        .unwrap();

    let mut reader = pty.reader();
    let mut output = String::new();

    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        reader.read_to_string(&mut output),
    )
    .await
    .expect("read timed out")
    .expect("read error");

    assert!(output.contains("hello"), "expected 'hello' in {:?}", output);
}

/// SC-03: Write to PTY stdin and read the echoed output back.
#[tokio::test]
async fn test_write_input() {
    let pty = CommandBuilder::new("/bin/sh").spawn().await.unwrap();

    let mut writer = pty.writer();
    writer.write_all(b"echo test123\n").await.unwrap();

    // Give the shell time to execute and echo
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let mut reader = pty.reader();
    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(std::time::Duration::from_secs(5), reader.read(&mut buf))
        .await
        .expect("read timed out")
        .expect("read error");

    let output = String::from_utf8_lossy(&buf[..n]);
    assert!(
        output.contains("test123"),
        "expected 'test123' in {:?}",
        output
    );

    pty.kill().ok();
}

/// SC-04: Resize the PTY without error.
#[tokio::test]
async fn test_resize() {
    let pty = CommandBuilder::new("/bin/sh").spawn().await.unwrap();
    pty.resize(PtySize {
        cols: 120,
        rows: 40,
    })
    .await
    .unwrap();
    pty.kill().ok();
}

/// SC-05: Exit code is propagated correctly.
#[tokio::test]
async fn test_exit_code() {
    let mut pty = CommandBuilder::new("/bin/sh")
        .arg("-c")
        .arg("exit 42")
        .spawn()
        .await
        .unwrap();

    let status = tokio::time::timeout(std::time::Duration::from_secs(10), pty.wait())
        .await
        .expect("wait timed out")
        .expect("wait error");

    assert_eq!(
        status.code(),
        Some(42),
        "expected exit code 42, got {:?}",
        status
    );
}

/// SC-06: Env and cwd are set in the child.
#[tokio::test]
async fn test_env_and_cwd() {
    let pty = CommandBuilder::new("/bin/sh")
        .arg("-c")
        .arg("echo $FOO && pwd")
        .env("FOO", "bar")
        .current_dir("/tmp")
        .spawn()
        .await
        .unwrap();

    let mut reader = pty.reader();
    let mut output = String::new();

    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        reader.read_to_string(&mut output),
    )
    .await
    .expect("read timed out")
    .expect("read error");

    assert!(output.contains("bar"), "expected 'bar' in {:?}", output);
    assert!(output.contains("/tmp"), "expected '/tmp' in {:?}", output);
}

/// SC-08: Spawning a non-existent program returns an error.
#[tokio::test]
async fn test_spawn_nonexistent() {
    let result = CommandBuilder::new("/nonexistent/shell").spawn().await;
    assert!(result.is_err(), "expected error for non-existent program");
}

/// SC-07: Ctrl+C (SIGINT via ETX byte) terminates the child.
///
/// Validates that `TIOCSCTTY` was called so the PTY master is the controlling
/// terminal of the child's process group. Without it, `\x03` would be passed
/// as literal data rather than generating SIGINT.
#[tokio::test]
async fn test_ctrl_c_signal() {
    let mut pty = CommandBuilder::new("/bin/sh")
        .arg("-c")
        .arg("sleep 60")
        .spawn()
        .await
        .unwrap();

    // Wait for the shell (and sleep) to be running
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let mut writer = pty.writer();
    writer.write_all(b"\x03").await.unwrap();

    let status = tokio::time::timeout(std::time::Duration::from_secs(5), pty.wait())
        .await
        .expect("wait timed out after Ctrl+C")
        .expect("wait error");

    // The shell or sleep should have been interrupted — either a signal or
    // a non-zero exit code is acceptable.
    assert!(
        status.code().is_some() || status.signal().is_some(),
        "expected exit via code or signal after Ctrl+C, got nothing"
    );
}

/// Verify `env_clear` strips inherited environment variables.
#[tokio::test]
async fn test_env_clear() {
    // We know HOME is set in the test process environment. After env_clear it
    // should not be visible in the child (unless we re-export it, which we
    // don't here).
    let pty = CommandBuilder::new("/bin/sh")
        .arg("-c")
        .arg("echo HOME=${HOME}")
        .env_clear()
        .spawn()
        .await
        .unwrap();

    let mut reader = pty.reader();
    let mut output = String::new();

    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        reader.read_to_string(&mut output),
    )
    .await
    .expect("read timed out")
    .expect("read error");

    // HOME should be unset → "HOME=" with empty value
    assert!(
        output.contains("HOME=\r") || output.contains("HOME=\n"),
        "expected empty HOME in {:?}",
        output
    );
}

/// Verify `ExitStatus` convenience methods.
#[test]
fn test_exit_status_api() {
    let s = crate::ExitStatus::from_code(0);
    assert!(s.success());
    assert_eq!(s.code(), Some(0));
    assert_eq!(s.signal(), None);

    let s = crate::ExitStatus::from_code(1);
    assert!(!s.success());

    let s = crate::ExitStatus::from_signal(9);
    assert_eq!(s.code(), None);
    assert_eq!(s.signal(), Some(9));
    assert!(!s.success());
}

/// Verify `PtySize` default.
#[test]
fn test_pty_size_default() {
    let sz = PtySize::default();
    assert_eq!(sz.cols, 80);
    assert_eq!(sz.rows, 24);
}
