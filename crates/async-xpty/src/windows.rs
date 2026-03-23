//! Windows ConPTY backend for `async-xpty`.
//!
//! Uses the Windows Pseudo Console (ConPTY) API introduced in Windows 10 1809.
//!
//! # Architecture
//!
//! ```text
//! CreatePipe(stdin)  → hStdinRead  (child reads)  / hStdinWrite  (we write)
//! CreatePipe(stdout) → hStdoutWrite (child writes) / hStdoutRead  (we read)
//! CreatePseudoConsole(size, hStdinRead, hStdoutWrite) → hPC
//! CreateProcessW(shell, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE=hPC) → hProcess
//! ```
//!
//! Because anonymous pipes don't support overlapped I/O, all blocking
//! `ReadFile`/`WriteFile` calls are dispatched to `tokio::task::spawn_blocking`
//! so the async executor remains unblocked.
//!
//! # ConPTY `\x1b[6n` deadlock fix
//!
//! ConPTY occasionally injects a DSR (cursor position request) `\x1b[6n` into
//! the output stream. If the reader doesn't respond with `\x1b[{row};{col}R`,
//! ConPTY will stall all I/O. The reader in this module detects this sequence
//! in output chunks and immediately writes a static `\x1b[1;1R` back to the
//! input pipe as a best-effort response. The nexterm agent's vt100 state mirror
//! provides accurate responses at a higher level.

use std::io;
use std::sync::Arc;

use tokio::task;

use windows_sys::Win32::Foundation::SetHandleInformation;
use windows_sys::Win32::Foundation::{
    CloseHandle, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, S_OK,
};
use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
use windows_sys::Win32::System::Console::{
    ClosePseudoConsole, CreatePseudoConsole, GetStdHandle, ResizePseudoConsole, COORD, HPCON,
    STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
    InitializeProcThreadAttributeList, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject, EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOEXW,
};

use crate::{CommandBuilder, ExitStatus, PtySize};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` attribute identifier.
///
/// Defined as `22 | 0x0002_0000` in the Windows SDK. We hard-code it here
/// rather than depending on a feature flag that may not be stable across
/// `windows-sys` versions.
const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x0002_0016;

/// The DSR sequence ConPTY injects. Detecting this prevents a deadlock.
const DSR_QUERY: &[u8] = b"\x1b[6n";
/// A static cursor-position response, sufficient to unblock ConPTY.
const DSR_RESPONSE: &[u8] = b"\x1b[1;1R";

// ─────────────────────────────────────────────────────────────────────────────
// Send/Sync safety wrappers
// ─────────────────────────────────────────────────────────────────────────────

/// A HANDLE wrapper that is safe to send across threads.
///
/// Windows HANDLEs are `*mut _` which are not `Send` by default. ConPTY and
/// pipe handles are designed to be passed between threads via documented APIs.
#[derive(Debug)]
struct SendHandle(HANDLE);

// SAFETY: Windows HANDLE values represent kernel objects that are inherently
// reference-counted by the kernel and safe to use from any thread.
unsafe impl Send for SendHandle {}
unsafe impl Sync for SendHandle {}

impl Drop for SendHandle {
    fn drop(&mut self) {
        if self.0 != INVALID_HANDLE_VALUE && !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// A `HPCON` wrapper that is safe to send across threads.
///
/// Supports idempotent `close()` — the watcher thread calls it when the child
/// exits, and `Drop` is a no-op if already closed.  This breaks the ConPTY
/// shutdown deadlock: without explicit close, conhost.exe keeps the stdout pipe
/// open until `ClosePseudoConsole` is called, but the pipe reader blocks the
/// task that would eventually drop the handle.
#[derive(Debug)]
struct SendHpcon {
    val: HPCON,
    closed: std::sync::atomic::AtomicBool,
}

impl SendHpcon {
    fn new(val: HPCON) -> Self {
        Self {
            val,
            closed: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Close the pseudo-console.  Idempotent — safe to call from any thread,
    /// any number of times.  The first call closes; subsequent calls are no-ops.
    fn close(&self) {
        if !self.closed.swap(true, std::sync::atomic::Ordering::SeqCst) {
            unsafe { ClosePseudoConsole(self.val) };
        }
    }
}

// SAFETY: HPCON is a pseudo-console handle, which is kernel-managed and
// safe to use from any thread once created.  AtomicBool is inherently
// Send + Sync.
unsafe impl Send for SendHpcon {}
unsafe impl Sync for SendHpcon {}

impl Drop for SendHpcon {
    fn drop(&mut self) {
        // `get_mut` is safe — Drop guarantees exclusive access.
        if !*self.closed.get_mut() && self.val != 0 {
            unsafe { ClosePseudoConsole(self.val) };
        }
    }
}

/// Cast a `HANDLE` (`*mut c_void`) to `usize` for cross-thread capture.
///
/// `usize` is `Send + 'static` unconditionally. We cast back to `HANDLE`
/// inside the closure. Windows kernel objects are reference-counted by the
/// kernel and safe to use from any thread.
///
/// # Safety
/// The caller must ensure the handle remains valid for the lifetime of all
/// threads that hold a copy of this value.
#[inline(always)]
fn handle_as_usize(h: HANDLE) -> usize {
    h as usize
}
#[inline(always)]
fn usize_as_handle(v: usize) -> HANDLE {
    v as HANDLE
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/// Windows-specific PTY process, backed by ConPTY.
///
/// Obtained indirectly via [`CommandBuilder::spawn`].
///
/// Channel-backed I/O is initialized at spawn time so that
/// [`WinPtyProcess::reader`] and [`WinPtyProcess::writer`] return working async
/// types immediately, without any additional setup call.
pub struct WinPtyProcess {
    /// The pseudo-console handle.
    hpc: Arc<SendHpcon>,
    /// The child process handle.
    process_handle: SendHandle,
    /// The child process ID.
    process_id: u32,
    /// Shared receiver so `reader()` can be called multiple times.
    output_rx: Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<io::Result<Vec<u8>>>>>,
    /// Cloneable sender for the stdin channel.
    input_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
}

impl WinPtyProcess {
    /// Returns an async reader that reads the child's output.
    ///
    /// Backed by a background `spawn_blocking` thread started at spawn time
    /// that pumps bytes from the ConPTY stdout pipe into a tokio mpsc channel.
    /// Multiple callers share the channel via `Arc<Mutex<Receiver>>`.
    pub fn reader(&self) -> WinPtyReader {
        WinPtyReader {
            rx: Arc::clone(&self.output_rx),
            leftover: Vec::new(),
            leftover_offset: 0,
        }
    }

    /// Returns an async writer that writes to the child's stdin.
    ///
    /// Backed by a background `spawn_blocking` thread started at spawn time
    /// that drains a tokio mpsc channel into the ConPTY stdin pipe.
    /// `mpsc::Sender` is `Clone`, so multiple writers coexist safely.
    pub fn writer(&self) -> WinPtyWriter {
        WinPtyWriter {
            tx: self.input_tx.clone(),
        }
    }

    /// Resize the ConPTY window.
    pub async fn resize(&self, size: PtySize) -> io::Result<()> {
        let coord = COORD {
            X: size.cols as i16,
            Y: size.rows as i16,
        };
        let hpc_raw = self.hpc.val;
        task::spawn_blocking(move || {
            let hr = unsafe { ResizePseudoConsole(hpc_raw, coord) };
            if hr >= S_OK {
                Ok(())
            } else {
                Err(io::Error::from_raw_os_error(hr))
            }
        })
        .await
        .map_err(io::Error::other)?
    }

    /// Wait for the child process to exit and return its [`ExitStatus`].
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        let raw_handle = handle_as_usize(self.process_handle.0);
        task::spawn_blocking(move || {
            let h = usize_as_handle(raw_handle);
            let wait_result = unsafe { WaitForSingleObject(h, INFINITE) };
            // WAIT_OBJECT_0 == 0; anything else is an error.
            if wait_result != 0 {
                return Err(io::Error::last_os_error());
            }
            let mut exit_code: u32 = 0;
            let ok = unsafe { GetExitCodeProcess(h, &mut exit_code) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(ExitStatus::from_code(exit_code as i32))
        })
        .await
        .map_err(io::Error::other)?
    }

    /// Returns the OS process ID of the child.
    pub fn pid(&self) -> u32 {
        self.process_id
    }

    /// Forcefully terminate the child process.
    pub fn kill(&self) -> io::Result<()> {
        let ok = unsafe { TerminateProcess(self.process_handle.0, 1) };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async I/O — reader
// ─────────────────────────────────────────────────────────────────────────────

/// Async reader for the ConPTY child's stdout.
///
/// Backed by a tokio mpsc channel pumped by a `spawn_blocking` thread.
/// The receiver is wrapped in `Arc<Mutex<...>>` so multiple `WinPtyReader`
/// instances share the same underlying channel.
pub struct WinPtyReader {
    rx: Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<io::Result<Vec<u8>>>>>,
    /// Leftover bytes from a previous chunk that didn't fit in the caller's buf.
    leftover: Vec<u8>,
    /// Read cursor into `leftover`.
    leftover_offset: usize,
}

impl tokio::io::AsyncRead for WinPtyReader {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        // Drain leftover bytes from a previous large chunk first.
        if self.leftover_offset < self.leftover.len() {
            let available = &self.leftover[self.leftover_offset..];
            let n = available.len().min(buf.remaining());
            buf.put_slice(&available[..n]);
            self.leftover_offset += n;
            if self.leftover_offset >= self.leftover.len() {
                self.leftover.clear();
                self.leftover_offset = 0;
            }
            return std::task::Poll::Ready(Ok(()));
        }

        // Try to lock the shared receiver without blocking. If another
        // concurrent poll_read holds the lock, wake immediately and return Pending.
        let mut guard = match self.rx.try_lock() {
            Ok(g) => g,
            Err(_) => {
                cx.waker().wake_by_ref();
                return std::task::Poll::Pending;
            }
        };

        // Poll the channel for the next chunk.
        let poll_result = guard.poll_recv(cx);
        // Drop the guard before any mutation of `self` to avoid the
        // immutable-borrow-while-mutably-borrowed conflict on Pin<&mut Self>.
        drop(guard);

        match poll_result {
            std::task::Poll::Pending => std::task::Poll::Pending,
            std::task::Poll::Ready(None) => {
                // Channel closed — EOF.
                std::task::Poll::Ready(Ok(()))
            }
            std::task::Poll::Ready(Some(Err(e))) => std::task::Poll::Ready(Err(e)),
            std::task::Poll::Ready(Some(Ok(chunk))) => {
                let n = chunk.len().min(buf.remaining());
                buf.put_slice(&chunk[..n]);
                if n < chunk.len() {
                    // Store the excess bytes for the next poll_read call.
                    self.leftover = chunk;
                    self.leftover_offset = n;
                }
                std::task::Poll::Ready(Ok(()))
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async I/O — writer
// ─────────────────────────────────────────────────────────────────────────────

/// Async writer for the ConPTY child's stdin.
///
/// Backed by a tokio mpsc channel drained by a `spawn_blocking` thread.
/// `mpsc::Sender` is `Clone`, so multiple `WinPtyWriter` instances coexist.
pub struct WinPtyWriter {
    tx: tokio::sync::mpsc::Sender<Vec<u8>>,
}

impl tokio::io::AsyncWrite for WinPtyWriter {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<io::Result<usize>> {
        // `try_send` is non-blocking. If the channel is full, wake immediately
        // and return Pending so the runtime retries. The channel has capacity 64
        // and carries keyboard input chunks, so saturation is rare.
        match self.tx.try_send(buf.to_vec()) {
            Ok(()) => std::task::Poll::Ready(Ok(buf.len())),
            Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                cx.waker().wake_by_ref();
                std::task::Poll::Pending
            }
            Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => std::task::Poll::Ready(Err(
                io::Error::new(io::ErrorKind::BrokenPipe, "stdin channel closed"),
            )),
        }
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        std::task::Poll::Ready(Ok(()))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn
// ─────────────────────────────────────────────────────────────────────────────

/// Spawn a command in a new ConPTY. Called by [`CommandBuilder::spawn`].
pub async fn spawn(cmd: CommandBuilder) -> io::Result<WinPtyProcess> {
    task::spawn_blocking(move || spawn_sync(&cmd))
        .await
        .map_err(io::Error::other)?
}

/// Synchronous spawn — called from `spawn_blocking`.
///
/// After `CreateProcessW` succeeds, immediately starts background I/O threads
/// so [`WinPtyProcess::reader`] and [`WinPtyProcess::writer`] return working
/// async types without any additional setup by the caller.
fn spawn_sync(cmd: &CommandBuilder) -> io::Result<WinPtyProcess> {
    // ── 1. Create stdin pipe: parent writes, child reads ──────────────────────
    //   hStdinRead  → ConPTY input (owned by ConPTY)
    //   hStdinWrite → parent writes here
    let mut stdin_read: HANDLE = INVALID_HANDLE_VALUE;
    let mut stdin_write: HANDLE = INVALID_HANDLE_VALUE;
    let ok = unsafe { CreatePipe(&mut stdin_read, &mut stdin_write, std::ptr::null(), 0) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    // Wrap early so they're closed on error paths via Drop.
    let stdin_read = SendHandle(stdin_read);
    let stdin_write = SendHandle(stdin_write);

    // ── 2. Create stdout pipe: child writes, parent reads ─────────────────────
    //   hStdoutRead  → parent reads here
    //   hStdoutWrite → ConPTY output (owned by ConPTY)
    let mut stdout_read: HANDLE = INVALID_HANDLE_VALUE;
    let mut stdout_write: HANDLE = INVALID_HANDLE_VALUE;
    let ok = unsafe { CreatePipe(&mut stdout_read, &mut stdout_write, std::ptr::null(), 0) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let stdout_read = SendHandle(stdout_read);
    let stdout_write = SendHandle(stdout_write);

    // ── 3. Prevent ConPTY stdout leak ─────────────────────────────────────────
    // Clear HANDLE_FLAG_INHERIT on the agent's own stdout/stderr BEFORE
    // CreatePseudoConsole. ConPTY internally spawns conhost.exe which inherits
    // all inheritable handles from the calling process. If the agent's stdout
    // pipe (connected to the hub) is inheritable, conhost passes it to the
    // child shell, causing shell output to leak to the hub's frame reader.
    unsafe {
        let h_stdout = GetStdHandle(STD_OUTPUT_HANDLE);
        if h_stdout != INVALID_HANDLE_VALUE && !h_stdout.is_null() {
            SetHandleInformation(h_stdout, HANDLE_FLAG_INHERIT, 0);
        }
        let h_stderr = GetStdHandle(STD_ERROR_HANDLE);
        if h_stderr != INVALID_HANDLE_VALUE && !h_stderr.is_null() {
            SetHandleInformation(h_stderr, HANDLE_FLAG_INHERIT, 0);
        }
    }

    // ── 4. CreatePseudoConsole ────────────────────────────────────────────────
    let size = COORD {
        X: cmd.size.cols as i16,
        Y: cmd.size.rows as i16,
    };
    let mut hpc: HPCON = 0;
    // flags=0: ConPTY blocks on DSR until reactive handler responds.
    // ConPTY CONSUMES the response (doesn't pass to child).
    let hr = unsafe { CreatePseudoConsole(size, stdin_read.0, stdout_write.0, 0, &mut hpc) };
    if hr < S_OK {
        return Err(io::Error::from_raw_os_error(hr));
    }
    let hpc = Arc::new(SendHpcon::new(hpc));

    // Close the ConPTY-side pipe ends. ConPTY has duplicated them internally
    // (per Microsoft sample: "Close handles to PTY after creating pseudoconsole").
    drop(stdin_read);
    drop(stdout_write);

    // ── 4. Initialize process thread attribute list ───────────────────────────
    let mut attr_list_size: usize = 0;
    unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut attr_list_size) };
    let mut attr_list_buf: Vec<u8> = vec![0u8; attr_list_size];
    let attr_list = attr_list_buf.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
    let ok = unsafe { InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_list_size) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }

    // Pass the HPCON value AS a pointer (not a pointer TO the value).
    // C equivalent: UpdateProcThreadAttribute(..., hPC, sizeof(HPCON), ...)
    // where hPC is passed by value as PVOID.
    let ok = unsafe {
        UpdateProcThreadAttribute(
            attr_list,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            hpc.val as *const _,
            std::mem::size_of::<HPCON>(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        unsafe { DeleteProcThreadAttributeList(attr_list) };
        return Err(io::Error::last_os_error());
    }

    // ── 5. Build STARTUPINFOEXW ───────────────────────────────────────────────
    let mut si_ex: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    si_ex.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    si_ex.lpAttributeList = attr_list;
    // CRITICAL: Set STARTF_USESTDHANDLES with INVALID_HANDLE_VALUE to prevent
    // the child from inheriting the parent's std handles. In daemon mode
    // (stdio:ignore), the parent has NUL handles which confuse the shell.
    // The pseudoconsole provides the actual console handles to the child.
    // (Ref: wezterm's ConPTY implementation uses this pattern.)
    si_ex.StartupInfo.dwFlags = 0x00000100; // STARTF_USESTDHANDLES
    si_ex.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
    si_ex.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
    si_ex.StartupInfo.hStdError = INVALID_HANDLE_VALUE;

    // ── 6. Build command line (UTF-16) ────────────────────────────────────────
    let cmdline = build_cmdline(&cmd.program, &cmd.args);
    let mut cmdline_w: Vec<u16> = cmdline.encode_utf16().chain(std::iter::once(0)).collect();

    // ── 7. Build current directory (UTF-16) ──────────────────────────────────
    // If no cwd provided, default to USERPROFILE or SYSTEMROOT to avoid
    // inheriting an invalid cwd (e.g. UNC path from WSL interop which causes
    // STATUS_DLL_NOT_FOUND / 0xC0000142 on cmd.exe).
    let effective_cwd: Option<String> = cmd
        .cwd
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .or_else(|| std::env::var("USERPROFILE").ok())
        .or_else(|| std::env::var("SYSTEMROOT").ok());
    let cwd_w: Option<Vec<u16>> = effective_cwd
        .as_ref()
        .map(|s| s.encode_utf16().chain(std::iter::once(0)).collect());
    let cwd_ptr = cwd_w
        .as_ref()
        .map(|v| v.as_ptr())
        .unwrap_or(std::ptr::null());

    // ── 8. Build environment block ───────────────────────────────────────────
    // ALWAYS build an explicit env block on Windows. When the agent runs under
    // WSL interop the inherited environment contains Linux-style PATH entries
    // that prevent child processes from finding system DLLs (STATUS_DLL_NOT_FOUND).
    let env_block: Vec<u16> = {
        let mut map: std::collections::HashMap<String, String> = if cmd.env_clear {
            std::collections::HashMap::new()
        } else {
            std::env::vars().collect()
        };
        map.extend(cmd.env.clone());
        let sys_root = std::env::var("SystemRoot")
            .or_else(|_| std::env::var("SYSTEMROOT"))
            .unwrap_or_else(|_| r"C:\Windows".to_string());
        let required_paths = [
            format!(r"{}\System32", sys_root),
            sys_root.clone(),
            format!(r"{}\System32\Wbem", sys_root),
        ];
        let current_path = map
            .get("PATH")
            .or(map.get("Path"))
            .cloned()
            .unwrap_or_default();
        let current_lower: Vec<String> =
            current_path.split(';').map(|s| s.to_lowercase()).collect();
        let mut additions = Vec::new();
        for rp in &required_paths {
            if !current_lower.iter().any(|p| p == &rp.to_lowercase()) {
                additions.push(rp.clone());
            }
        }
        if !additions.is_empty() {
            let new_path = if current_path.is_empty() {
                additions.join(";")
            } else {
                format!("{};{}", additions.join(";"), current_path)
            };
            map.remove("Path");
            map.insert("PATH".to_string(), new_path);
        }
        build_env_block(&map)
    };
    let env_ptr = env_block.as_ptr();
    let create_flags: PROCESS_CREATION_FLAGS = EXTENDED_STARTUPINFO_PRESENT | 0x0000_0400u32;

    // ── 10. CreateProcessW ────────────────────────────────────────────────────
    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CreateProcessW(
            std::ptr::null(),       // lpApplicationName (use cmdline)
            cmdline_w.as_mut_ptr(), // lpCommandLine (mutable)
            std::ptr::null(),       // lpProcessAttributes
            std::ptr::null(),       // lpThreadAttributes
            0,                      // bInheritHandles = FALSE
            create_flags,
            env_ptr as *const _, // lpEnvironment
            cwd_ptr,             // lpCurrentDirectory
            &si_ex.StartupInfo,  // lpStartupInfo (STARTUPINFOEX)
            &mut pi,             // lpProcessInformation
        )
    };

    unsafe { DeleteProcThreadAttributeList(attr_list) };

    if ok == 0 {
        return Err(io::Error::last_os_error());
    }

    unsafe { CloseHandle(pi.hThread) };

    // (diagnostics removed)

    // Watcher: close pseudoconsole when child exits
    {
        let hpc_watcher = Arc::clone(&hpc);
        let child_handle = handle_as_usize(pi.hProcess);
        task::spawn_blocking(move || {
            unsafe { WaitForSingleObject(usize_as_handle(child_handle), INFINITE) };
            hpc_watcher.close();
        });
    }

    // ── 10b. Initialize channel-backed I/O (at spawn time) ───────────────────
    // Channels are created here so reader() and writer() return working types
    // immediately — no extra setup call needed from the caller.

    // stdout channel: blocking reader thread → async consumer (bounded, 64)
    let (stdout_tx, stdout_rx) = tokio::sync::mpsc::channel::<io::Result<Vec<u8>>>(64);
    // stdin channel: async producer → blocking writer thread (bounded, 64)
    let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

    // Convert HANDLEs to usize so the closures are Send + 'static.
    // stdin_write is used by both the DSR-response path (inside the read loop)
    // and the stdin write loop — two independent usize copies.
    let stdout_read_usize = handle_as_usize(stdout_read.0);
    let stdin_write_for_dsr = handle_as_usize(stdin_write.0);
    let stdin_write_usize = handle_as_usize(stdin_write.0);

    // Transfer ownership of the raw handles to the background threads.
    // `forget` prevents the `SendHandle` Drop impl from closing them here.
    // Each background thread closes its handle when its loop exits.
    std::mem::forget(stdout_read);
    std::mem::forget(stdin_write);

    // Background thread: read from stdout pipe, detect DSR, send chunks.
    task::spawn_blocking(move || {
        // Do NOT write a pre-emptive DSR response.  With INHERIT_CURSOR,
        // ConPTY does not block on DSR.  Writing \x1b[1;1R here pollutes
        // the child's console input buffer and kills the shell.

        let mut buf = vec![0u8; 4096];
        loop {
            let mut bytes_read: u32 = 0;
            let ok = unsafe {
                ReadFile(
                    usize_as_handle(stdout_read_usize),
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut bytes_read,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || bytes_read == 0 {
                let err = io::Error::last_os_error();
                let _ = stdout_tx.blocking_send(Err(err));
                unsafe { CloseHandle(usize_as_handle(stdout_read_usize)) };
                break;
            }
            let chunk = buf[..bytes_read as usize].to_vec();

            // Reactive DSR: with flags=0, ConPTY blocks until this response.
            // ConPTY CONSUMES it (expected response) — NOT passed to child.
            if contains_dsr(&chunk) {
                let mut written: u32 = 0;
                unsafe {
                    WriteFile(
                        usize_as_handle(stdin_write_for_dsr),
                        DSR_RESPONSE.as_ptr(),
                        DSR_RESPONSE.len() as u32,
                        &mut written,
                        std::ptr::null_mut(),
                    )
                };
            }

            if stdout_tx.blocking_send(Ok(chunk)).is_err() {
                unsafe { CloseHandle(usize_as_handle(stdout_read_usize)) };
                break;
            }
        }
    });

    // Background thread: receive from stdin channel, write to stdin pipe.
    task::spawn_blocking(move || {
        while let Some(data) = stdin_rx.blocking_recv() {
            let mut offset = 0usize;
            while offset < data.len() {
                let mut written: u32 = 0;
                let ok = unsafe {
                    WriteFile(
                        usize_as_handle(stdin_write_usize),
                        data[offset..].as_ptr(),
                        (data.len() - offset) as u32,
                        &mut written,
                        std::ptr::null_mut(),
                    )
                };
                if ok == 0 {
                    break;
                }
                offset += written as usize;
            }
        }
        // Channel closed — clean up the handle.
        unsafe { CloseHandle(usize_as_handle(stdin_write_usize)) };
    });

    Ok(WinPtyProcess {
        hpc,
        process_handle: SendHandle(pi.hProcess),
        process_id: pi.dwProcessId,
        output_rx: Arc::new(tokio::sync::Mutex::new(stdout_rx)),
        input_tx: stdin_tx,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Returns `true` if `data` contains a DSR query sequence (`\x1b[6n`).
fn contains_dsr(data: &[u8]) -> bool {
    data.windows(DSR_QUERY.len()).any(|w| w == DSR_QUERY)
}

/// Build a properly quoted command line string for `CreateProcessW`.
///
/// Rules (simplified, sufficient for our use case):
/// - If an argument contains a space or quote, wrap it in double-quotes and
///   escape internal double-quotes as `\"`.
/// - Otherwise pass the argument as-is.
fn build_cmdline(program: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(1 + args.len());
    parts.push(quote_arg(program));
    for a in args {
        parts.push(quote_arg(a));
    }
    parts.join(" ")
}

fn quote_arg(s: &str) -> String {
    if s.is_empty() {
        "\"\"".to_string()
    } else if !s.contains(' ') && !s.contains('"') && !s.contains('\t') {
        s.to_string()
    } else {
        let escaped = s.replace('"', "\\\"");
        format!("\"{}\"", escaped)
    }
}

/// Build a null-terminated, double-null-terminated UTF-16 environment block
/// as required by `CreateProcessW` with `CREATE_UNICODE_ENVIRONMENT`.
///
/// Format: `KEY=VALUE\0KEY=VALUE\0\0`
fn build_env_block(env: &std::collections::HashMap<String, String>) -> Vec<u16> {
    let mut block: Vec<u16> = Vec::new();
    for (k, v) in env {
        let entry = format!("{}={}", k, v);
        block.extend(entry.encode_utf16());
        block.push(0); // null-terminate each entry
    }
    block.push(0); // double-null to terminate the block
    block
}
