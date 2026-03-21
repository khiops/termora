//! Unix PTY backend using `nix` + tokio `AsyncFd`.
//!
//! # Fork/exec flow
//!
//! 1. `openpty()` creates master/slave fd pair with the requested window size.
//! 2. `fork()` — child sets up stdio on slave fd and calls `execvp`.
//! 3. Parent closes slave fd, sets master non-blocking, wraps in `AsyncFd`.

use std::collections::HashMap;
use std::ffi::{CString, NulError};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use nix::pty::Winsize;
use nix::sys::wait::{waitpid, WaitPidFlag, WaitStatus};
use nix::unistd::Pid;
use tokio::io::ReadBuf;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::{CommandBuilder, ExitStatus, PtySize};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

fn to_winsize(size: &PtySize) -> Winsize {
	Winsize { ws_col: size.cols, ws_row: size.rows, ws_xpixel: 0, ws_ypixel: 0 }
}

fn to_cstring(s: &str) -> io::Result<CString> {
	CString::new(s).map_err(|e: NulError| {
		io::Error::new(io::ErrorKind::InvalidInput, format!("nul byte in string: {}", e))
	})
}

/// Set a raw fd non-blocking.
fn set_nonblocking(fd: RawFd) -> io::Result<()> {
	let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
	if flags == -1 {
		return Err(io::Error::last_os_error());
	}
	let rc = unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
	if rc == -1 {
		return Err(io::Error::last_os_error());
	}
	Ok(())
}

/// Close all file descriptors >= 3 in the child process, except those in
/// `keep`.
///
/// Tries `/dev/fd` first (Linux/macOS), then falls back to closing
/// descriptors 3..1024 individually.
fn close_fds_above_2_except(keep: &[RawFd]) {
	// Try /dev/fd (Linux procfs or macOS fdescfs)
	if let Ok(dir) = std::fs::read_dir("/dev/fd") {
		let fds: Vec<i32> = dir
			.flatten()
			.filter_map(|e| e.file_name().to_str().and_then(|n| n.parse::<i32>().ok()))
			.filter(|fd| *fd >= 3 && !keep.contains(fd))
			.collect();
		for fd in fds {
			unsafe { libc::close(fd) };
		}
		return;
	}
	// Fallback: brute-force close
	for fd in 3..1024i32 {
		if !keep.contains(&fd) {
			unsafe { libc::close(fd) };
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared master fd — wrapped in Arc so reader and writer can share it
// ──────────────────────────────────────────────────────────────────────────────

/// Wraps the master PTY fd for async I/O via `AsyncFd`.
struct MasterFd {
	fd: tokio::io::unix::AsyncFd<OwnedFd>,
}

impl MasterFd {
	fn new(fd: OwnedFd) -> io::Result<Self> {
		set_nonblocking(fd.as_raw_fd())?;
		// Safety: fd is valid and non-blocking.
		Ok(Self { fd: tokio::io::unix::AsyncFd::new(fd)? })
	}

	fn raw(&self) -> RawFd {
		self.fd.as_raw_fd()
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Public process handle
// ──────────────────────────────────────────────────────────────────────────────

/// Unix-specific [`PtyProcess`](crate::PtyProcess) internals.
pub struct UnixPtyProcess {
	master: Arc<MasterFd>,
	pid: Pid,
}

impl UnixPtyProcess {
	pub fn reader(&self) -> UnixPtyReader {
		UnixPtyReader { master: Arc::clone(&self.master) }
	}

	pub fn writer(&self) -> UnixPtyWriter {
		UnixPtyWriter { master: Arc::clone(&self.master) }
	}

	pub async fn resize(&self, size: PtySize) -> io::Result<()> {
		let ws = to_winsize(&size);
		let rc = unsafe { libc::ioctl(self.master.raw(), libc::TIOCSWINSZ, &ws) };
		if rc == -1 {
			Err(io::Error::last_os_error())
		} else {
			Ok(())
		}
	}

	pub async fn wait(&mut self) -> io::Result<ExitStatus> {
		// Poll waitpid in a loop using tokio's yield mechanism so we don't
		// block the executor. A small delay keeps CPU usage low.
		loop {
			match waitpid(self.pid, Some(WaitPidFlag::WNOHANG)) {
				Ok(WaitStatus::Exited(_, code)) => return Ok(ExitStatus::from_code(code)),
				Ok(WaitStatus::Signaled(_, sig, _)) => {
					return Ok(ExitStatus::from_signal(sig as i32));
				}
				Ok(WaitStatus::StillAlive) => {
					tokio::time::sleep(std::time::Duration::from_millis(10)).await;
				}
				Ok(_) => {
					tokio::time::sleep(std::time::Duration::from_millis(10)).await;
				}
				Err(nix::errno::Errno::EINTR) => continue,
				Err(e) => {
					return Err(io::Error::from_raw_os_error(e as i32));
				}
			}
		}
	}

	pub fn pid(&self) -> u32 {
		self.pid.as_raw() as u32
	}

	pub fn kill(&self) -> io::Result<()> {
		let rc = unsafe { libc::kill(self.pid.as_raw(), libc::SIGKILL) };
		if rc == -1 {
			Err(io::Error::last_os_error())
		} else {
			Ok(())
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// AsyncRead / AsyncWrite implementations
// ──────────────────────────────────────────────────────────────────────────────

/// Async reader for the PTY master fd.
pub struct UnixPtyReader {
	master: Arc<MasterFd>,
}

impl AsyncRead for UnixPtyReader {
	fn poll_read(
		self: Pin<&mut Self>,
		cx: &mut Context<'_>,
		buf: &mut ReadBuf<'_>,
	) -> Poll<io::Result<()>> {
		loop {
			let mut guard = match self.master.fd.poll_read_ready(cx) {
				Poll::Ready(Ok(g)) => g,
				Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
				Poll::Pending => return Poll::Pending,
			};

			let dst = buf.initialize_unfilled();
			let rc = unsafe {
				libc::read(
					self.master.raw(),
					dst.as_mut_ptr() as *mut libc::c_void,
					dst.len(),
				)
			};

			if rc > 0 {
				buf.advance(rc as usize);
				return Poll::Ready(Ok(()));
			} else if rc == 0 {
				// EOF
				return Poll::Ready(Ok(()));
			} else {
				let err = io::Error::last_os_error();
				#[allow(unreachable_patterns)]
				match err.raw_os_error() {
					Some(libc::EAGAIN) | Some(libc::EWOULDBLOCK) => {
						// Not ready yet — clear readiness and retry
						guard.clear_ready();
						continue;
					}
					Some(libc::EIO) => {
						// Slave side was closed — treat as EOF
						return Poll::Ready(Ok(()));
					}
					_ => return Poll::Ready(Err(err)),
				}
			}
		}
	}
}

/// Async writer for the PTY master fd.
pub struct UnixPtyWriter {
	master: Arc<MasterFd>,
}

impl AsyncWrite for UnixPtyWriter {
	fn poll_write(
		self: Pin<&mut Self>,
		cx: &mut Context<'_>,
		buf: &[u8],
	) -> Poll<io::Result<usize>> {
		loop {
			let mut guard = match self.master.fd.poll_write_ready(cx) {
				Poll::Ready(Ok(g)) => g,
				Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
				Poll::Pending => return Poll::Pending,
			};

			let rc = unsafe {
				libc::write(
					self.master.raw(),
					buf.as_ptr() as *const libc::c_void,
					buf.len(),
				)
			};

			if rc >= 0 {
				return Poll::Ready(Ok(rc as usize));
			} else {
				let err = io::Error::last_os_error();
				#[allow(unreachable_patterns)]
				match err.raw_os_error() {
					Some(libc::EAGAIN) | Some(libc::EWOULDBLOCK) => {
						guard.clear_ready();
						continue;
					}
					_ => return Poll::Ready(Err(err)),
				}
			}
		}
	}

	fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
		Poll::Ready(Ok(()))
	}

	fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
		Poll::Ready(Ok(()))
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Spawn — the heart of the crate
// ──────────────────────────────────────────────────────────────────────────────

/// Spawn a command in a new PTY. Called by [`CommandBuilder::spawn`].
pub async fn spawn(cmd: CommandBuilder) -> io::Result<UnixPtyProcess> {
	let ws = to_winsize(&cmd.size);

	// ── 1. Open PTY pair ──────────────────────────────────────────────────────
	let result = nix::pty::openpty(Some(&ws), None)
		.map_err(|e| io::Error::from_raw_os_error(e as i32))?;

	// Detach ownership from nix so we can close fds manually after fork.
	let master_owned_raw = result.master.into_raw_fd();
	let slave_owned_raw = result.slave.into_raw_fd();

	// Prepare execvp args before forking so we don't allocate in child.
	let prog_cstr = to_cstring(&cmd.program)?;
	let mut argv_cstr: Vec<CString> = Vec::with_capacity(1 + cmd.args.len());
	argv_cstr.push(prog_cstr.clone());
	for a in &cmd.args {
		argv_cstr.push(to_cstring(a)?);
	}

	// Build final env: optional clear + overrides on top of inherited env.
	let final_env: HashMap<String, String> = if cmd.env_clear {
		cmd.env.clone()
	} else {
		let mut e: HashMap<String, String> = std::env::vars().collect();
		e.extend(cmd.env.clone());
		e
	};
	let env_cstrs: Vec<(CString, CString)> = final_env
		.iter()
		.map(|(k, v)| {
			let key = to_cstring(k)?;
			let val = to_cstring(v)?;
			Ok::<_, io::Error>((key, val))
		})
		.collect::<io::Result<_>>()?;

	let cwd_cstr: Option<CString> =
		cmd.cwd.as_deref().map(|p| to_cstring(p.to_str().unwrap_or(""))).transpose()?;

	// Pre-build argv pointer array (NULL-terminated) before the fork so that
	// child_setup never allocates (POSIX async-signal-safety).
	let argv_ptrs: Vec<*const libc::c_char> = argv_cstr
		.iter()
		.map(|s| s.as_ptr())
		.chain(std::iter::once(std::ptr::null()))
		.collect();

	// Pre-build "KEY=VAL" CStrings and their pointer array before the fork.
	let env_strings: Vec<CString> = env_cstrs
		.iter()
		.filter_map(|(k, v)| {
			let mut kv = k.to_bytes().to_vec();
			kv.push(b'=');
			kv.extend_from_slice(v.to_bytes());
			CString::new(kv).ok()
		})
		.collect();
	let envp_ptrs: Vec<*const libc::c_char> = env_strings
		.iter()
		.map(|s| s.as_ptr())
		.chain(std::iter::once(std::ptr::null()))
		.collect();

	// ── 2. Use a pipe to propagate exec errors from child to parent ───────────
	// We create a CLOEXEC pipe: child writes errno on exec failure, parent
	// reads it. If exec succeeds the write end is closed by CLOEXEC and the
	// parent reads 0 bytes (= success).
	let (pipe_read, pipe_write) = create_cloexec_pipe()?;

	// ── 3. Fork ───────────────────────────────────────────────────────────────
	let fork_res = unsafe { libc::fork() };
	match fork_res {
		-1 => {
			// Fork failed — close everything
			unsafe {
				libc::close(master_owned_raw);
				libc::close(slave_owned_raw);
				libc::close(pipe_read);
				libc::close(pipe_write);
			}
			return Err(io::Error::last_os_error());
		}

		0 => {
			// ── Child process ─────────────────────────────────────────────────
			// Must not allocate, must not call async code here.
			// Any error is written to pipe_write and the child exits.
			unsafe {
				// Close master fd (child only uses slave)
				libc::close(master_owned_raw);
				// Close pipe read end (child only writes)
				libc::close(pipe_read);

				child_setup(
					slave_owned_raw,
					pipe_write,
					&argv_ptrs,
					&envp_ptrs,
					&cwd_cstr,
				);
			}
			// child_setup calls exec or _exit — never returns normally
			std::process::exit(127);
		}

		child_pid => {
			// ── Parent process ────────────────────────────────────────────────
			unsafe {
				// Close slave fd (parent only uses master)
				libc::close(slave_owned_raw);
				// Close pipe write end (parent only reads)
				libc::close(pipe_write);
			}

			// Read from pipe to detect exec errors
			let mut errno_buf = [0u8; 4];
			let n = unsafe {
				libc::read(pipe_read, errno_buf.as_mut_ptr() as *mut libc::c_void, 4)
			};
			unsafe { libc::close(pipe_read) };

			if n == 4 {
				// Child sent errno — exec failed
				let errno_val = i32::from_ne_bytes(errno_buf);
				// Reap the zombie
				unsafe { libc::waitpid(child_pid, std::ptr::null_mut(), 0) };
				unsafe { libc::close(master_owned_raw) };
				return Err(io::Error::from_raw_os_error(errno_val));
			}
			// n == 0 → pipe closed by CLOEXEC = exec succeeded

			// Wrap master fd
			let master_owned = unsafe { OwnedFd::from_raw_fd(master_owned_raw) };
			let master = Arc::new(MasterFd::new(master_owned)?);

			Ok(UnixPtyProcess { master, pid: Pid::from_raw(child_pid) })
		}
	}
}

/// Create a pipe where both ends have `O_CLOEXEC`.
fn create_cloexec_pipe() -> io::Result<(RawFd, RawFd)> {
	let mut fds = [0i32; 2];
	#[cfg(target_os = "linux")]
	let rc = unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) };
	#[cfg(not(target_os = "linux"))]
	let rc = {
		let rc = unsafe { libc::pipe(fds.as_mut_ptr()) };
		if rc == 0 {
			// Set CLOEXEC on both ends manually (macOS doesn't have pipe2)
			unsafe {
				libc::fcntl(fds[0], libc::F_SETFD, libc::FD_CLOEXEC);
				libc::fcntl(fds[1], libc::F_SETFD, libc::FD_CLOEXEC);
			}
			0
		} else {
			rc
		}
	};
	if rc == -1 {
		return Err(io::Error::last_os_error());
	}
	Ok((fds[0], fds[1]))
}

/// Child-side setup: session, controlling terminal, stdio, env, exec.
///
/// # Safety
///
/// Must be called only in the child process after `fork()`. Must not allocate
/// memory or call non-async-signal-safe functions except via libc.
unsafe fn child_setup(
	slave_fd: RawFd,
	pipe_write: RawFd,
	argv_ptrs: &[*const libc::c_char],
	envp_ptrs: &[*const libc::c_char],
	cwd: &Option<CString>,
) {
	macro_rules! die {
		($errno:expr) => {{
			let e = $errno.to_ne_bytes();
			libc::write(pipe_write, e.as_ptr() as *const libc::c_void, 4);
			libc::_exit(1);
		}};
	}

	// New session — become session leader
	if libc::setsid() == -1 {
		die!(io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO));
	}

	// Set slave as controlling terminal (CRITICAL for Ctrl+C / job control)
	if libc::ioctl(slave_fd, libc::TIOCSCTTY as libc::c_ulong, 0) == -1 {
		die!(io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO));
	}

	// Dup slave to stdin/stdout/stderr
	for target in [0, 1, 2] {
		if libc::dup2(slave_fd, target) == -1 {
			die!(io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO));
		}
	}

	// Close all fds >= 3 except pipe_write.
	// - slave_fd is closed here (no longer needed after dup2).
	// - pipe_write has O_CLOEXEC so it auto-closes on successful exec. If
	//   exec fails we still need it to send errno back to the parent.
	close_fds_above_2_except(&[pipe_write]);

	// Change directory if requested
	if let Some(dir) = cwd {
		if libc::chdir(dir.as_ptr()) == -1 {
			die!(io::Error::last_os_error().raw_os_error().unwrap_or(libc::EIO));
		}
	}

	// argv_ptrs and envp_ptrs are pre-built NULL-terminated pointer arrays
	// constructed before the fork — no allocation occurs here.
	libc::execvpe(argv_ptrs[0], argv_ptrs.as_ptr(), envp_ptrs.as_ptr());

	// If we reach here, exec failed
	let err = io::Error::last_os_error().raw_os_error().unwrap_or(libc::ENOENT);
	die!(err);
}
