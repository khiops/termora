//! `async-xpty` — Cross-platform async PTY for tokio.
//!
//! This crate provides an ergonomic, async-native interface for spawning
//! processes inside a pseudo-terminal (PTY). It is built on top of tokio and
//! targets Linux, macOS (Unix family), and Windows (ConPTY, Windows 10 1809+).
//!
//! # Quick start
//!
//! ```no_run
//! use async_xpty::{CommandBuilder, PtySize};
//! use tokio::io::AsyncReadExt;
//!
//! #[tokio::main]
//! async fn main() -> std::io::Result<()> {
//!     let mut pty = CommandBuilder::new("/bin/sh")
//!         .arg("-c")
//!         .arg("echo hello")
//!         .size(80, 24)
//!         .spawn()
//!         .await?;
//!
//!     let mut buf = vec![0u8; 1024];
//!     let n = pty.reader().read(&mut buf).await?;
//!     println!("{}", String::from_utf8_lossy(&buf[..n]));
//!
//!     let status = pty.wait().await?;
//!     println!("exited: {:?}", status.code());
//!     Ok(())
//! }
//! ```

pub mod command;

#[cfg(unix)]
pub mod unix;

#[cfg(windows)]
pub mod windows;

#[cfg(test)]
mod tests;

pub use command::CommandBuilder;

use std::io;

/// Dimensions of a PTY window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
	/// Number of columns (width in characters).
	pub cols: u16,
	/// Number of rows (height in characters).
	pub rows: u16,
}

impl Default for PtySize {
	fn default() -> Self {
		Self { cols: 80, rows: 24 }
	}
}

/// The exit status of a PTY child process.
///
/// Exactly one of `code` or `signal` will be `Some` after a normal exit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitStatus {
	code: Option<i32>,
	signal: Option<i32>,
}

impl ExitStatus {
	/// Create an exit status from an exit code.
	pub fn from_code(code: i32) -> Self {
		Self { code: Some(code), signal: None }
	}

	/// Create an exit status from a signal number.
	pub fn from_signal(signal: i32) -> Self {
		Self { code: None, signal: Some(signal) }
	}

	/// The exit code, if the process exited normally.
	pub fn code(&self) -> Option<i32> {
		self.code
	}

	/// The signal number that terminated the process, if killed by a signal.
	pub fn signal(&self) -> Option<i32> {
		self.signal
	}

	/// Returns `true` if the process exited successfully (code 0).
	pub fn success(&self) -> bool {
		self.code == Some(0)
	}
}

impl std::fmt::Display for ExitStatus {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		if let Some(code) = self.code {
			write!(f, "exit code {}", code)
		} else if let Some(sig) = self.signal {
			write!(f, "signal {}", sig)
		} else {
			write!(f, "unknown exit")
		}
	}
}

/// A running process attached to a PTY master.
///
/// Provides async reader/writer halves and methods to resize, wait for exit,
/// and kill the child process.
///
/// Obtained by calling [`CommandBuilder::spawn`].
pub struct PtyProcess {
	#[cfg(unix)]
	inner: unix::UnixPtyProcess,
	#[cfg(windows)]
	inner: windows::WinPtyProcess,
}

impl PtyProcess {
	/// Returns an [`AsyncRead`](tokio::io::AsyncRead) half that reads from the
	/// PTY master.
	///
	/// Multiple calls return independent reader handles backed by the same fd.
	pub fn reader(&self) -> PtyReader {
		#[cfg(unix)]
		return PtyReader { inner: self.inner.reader() };

		#[cfg(windows)]
		return PtyReader { inner: self.inner.reader() };
	}

	/// Returns an [`AsyncWrite`](tokio::io::AsyncWrite) half that writes to
	/// the PTY master (i.e. the child's stdin).
	pub fn writer(&self) -> PtyWriter {
		#[cfg(unix)]
		return PtyWriter { inner: self.inner.writer() };

		#[cfg(windows)]
		return PtyWriter { inner: self.inner.writer() };
	}

	/// Resize the PTY window. Sends `SIGWINCH` to the process group on Unix so
	/// the running program can adapt its layout. On Windows, calls
	/// `ResizePseudoConsole`.
	pub async fn resize(&self, size: PtySize) -> io::Result<()> {
		#[cfg(unix)]
		return self.inner.resize(size).await;

		#[cfg(windows)]
		return self.inner.resize(size).await;
	}

	/// Wait for the child process to exit and return its [`ExitStatus`].
	///
	/// This consumes the mutable reference and should be called at most once.
	pub async fn wait(&mut self) -> io::Result<ExitStatus> {
		#[cfg(unix)]
		return self.inner.wait().await;

		#[cfg(windows)]
		return self.inner.wait().await;
	}

	/// Returns the OS process ID of the child.
	pub fn pid(&self) -> u32 {
		#[cfg(unix)]
		return self.inner.pid();

		#[cfg(windows)]
		return self.inner.pid();
	}

	/// Send `SIGKILL` to the child process on Unix, or `TerminateProcess` on
	/// Windows.
	///
	/// Prefer [`wait`](Self::wait) after writing an EOF or shell exit command
	/// for a graceful shutdown.
	pub fn kill(&self) -> io::Result<()> {
		#[cfg(unix)]
		return self.inner.kill();

		#[cfg(windows)]
		return self.inner.kill();
	}

}

/// Async reader for the PTY master fd.
///
/// Implements [`tokio::io::AsyncRead`].
pub struct PtyReader {
	#[cfg(unix)]
	inner: unix::UnixPtyReader,
	#[cfg(windows)]
	inner: windows::WinPtyReader,
}

impl tokio::io::AsyncRead for PtyReader {
	fn poll_read(
		self: std::pin::Pin<&mut Self>,
		cx: &mut std::task::Context<'_>,
		buf: &mut tokio::io::ReadBuf<'_>,
	) -> std::task::Poll<io::Result<()>> {
		#[cfg(unix)]
		{
			let inner = unsafe { self.map_unchecked_mut(|s| &mut s.inner) };
			return inner.poll_read(cx, buf);
		}

		#[cfg(windows)]
		{
			let inner = unsafe { self.map_unchecked_mut(|s| &mut s.inner) };
			return inner.poll_read(cx, buf);
		}
	}
}

/// Async writer for the PTY master fd (child stdin).
///
/// Implements [`tokio::io::AsyncWrite`].
pub struct PtyWriter {
	#[cfg(unix)]
	inner: unix::UnixPtyWriter,
	#[cfg(windows)]
	inner: windows::WinPtyWriter,
}

impl tokio::io::AsyncWrite for PtyWriter {
	fn poll_write(
		self: std::pin::Pin<&mut Self>,
		cx: &mut std::task::Context<'_>,
		buf: &[u8],
	) -> std::task::Poll<io::Result<usize>> {
		#[cfg(unix)]
		{
			let inner = unsafe { self.map_unchecked_mut(|s| &mut s.inner) };
			return inner.poll_write(cx, buf);
		}

		#[cfg(windows)]
		{
			let inner = unsafe { self.map_unchecked_mut(|s| &mut s.inner) };
			return inner.poll_write(cx, buf);
		}
	}

	fn poll_flush(
		self: std::pin::Pin<&mut Self>,
		_cx: &mut std::task::Context<'_>,
	) -> std::task::Poll<io::Result<()>> {
		// PTY master is not buffered at this layer; flush is a no-op.
		std::task::Poll::Ready(Ok(()))
	}

	fn poll_shutdown(
		self: std::pin::Pin<&mut Self>,
		_cx: &mut std::task::Context<'_>,
	) -> std::task::Poll<io::Result<()>> {
		std::task::Poll::Ready(Ok(()))
	}
}
