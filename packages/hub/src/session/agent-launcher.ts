import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { access, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AGENT_SOCKET_POLL_MS,
	AGENT_SOCKET_TIMEOUT,
	type AgentConfig,
	probeSocket,
} from "@termora/shared";
import { detectSea } from "@termora/shared/dist/sea-addon-loader.js";
import { resolveAgentBinaryPath } from "../sea-agent-resolver.js";
import { TermoraAgent } from "./termora-agent.js";

/**
 * Resolve the path to the agent binary.
 *
 * In SEA mode: looks for a co-located termora-agent binary next to the hub
 * executable. Falls back to PATH resolution via resolveAgentBinaryPath().
 *
 * In dev mode: returns the Rust agent binary built by cargo at
 *   <project-root>/target/release/termora-agent[.exe]
 */
export function resolveAgentPath(): string {
	const sea = detectSea();
	if (sea) {
		const seaPath = resolveAgentBinaryPath();
		if (seaPath) return seaPath;
	}
	// Dev mode fallback: Rust agent binary
	const __dirname = dirname(fileURLToPath(import.meta.url));
	// This file is at packages/hub/src/session/ — go up 4 levels to project root
	const ext = process.platform === "win32" ? ".exe" : "";
	return join(__dirname, "../../../..", `target/release/termora-agent${ext}`);
}

/**
 * Returns true if the given agent path is a self-contained executable
 * (i.e. a native binary) rather than a JS module file.
 */
export function isAgentBinary(agentPath: string): boolean {
	return !agentPath.endsWith(".js");
}

/**
 * Connect to an existing agent daemon or spawn a new one.
 *
 * Flow:
 * 1. Verify agent binary exists
 * 2. Probe socket: alive → connect, ECONNREFUSED/ENOENT → spawn
 * 3. If EACCES → throw (different user's socket — do NOT unlink)
 * 4. Spawn: child_process.spawn with detached + unref
 * 5. Poll for socket availability (100ms interval, 5s timeout)
 * 6. Connect via TermoraAgent.connectLocal
 */
export async function connectOrLaunch(
	socketPath: string,
	config: AgentConfig,
	agentBinaryPath?: string,
): Promise<TermoraAgent> {
	const agentPath = agentBinaryPath ?? resolveAgentPath();

	// Verify agent binary exists
	try {
		await access(agentPath);
	} catch (err) {
		throw new Error(
			`Agent binary not found: ${agentPath} (${err instanceof Error ? err.message : String(err)})`,
		);
	}

	// Try direct connect first — avoids a throwaway probe connection that
	// confuses the agent's AUTH handshake on Windows named pipes.
	try {
		return await TermoraAgent.connectLocal(socketPath);
	} catch {
		// Connection failed — agent not running or stale socket
	}

	// Clean up stale socket file if present (no-op on named pipes)
	try {
		await unlink(socketPath);
	} catch {
		// ENOENT is fine — file doesn't exist
	}

	// Spawn daemon
	const daemonLogPath = launchDaemon(agentPath, socketPath, config);

	// Wait for socket to become available
	await waitForSocket(socketPath, daemonLogPath);

	// Connect
	return TermoraAgent.connectLocal(socketPath);
}

/**
 * Spawn the agent as a detached daemon process.
 * The process is unref'd so the hub can exit without waiting for it.
 *
 * SEA mode: the agent path is a self-contained executable — spawn directly.
 * Dev mode: the agent path is a JS file — spawn via node.
 *
 * Returns the path to the daemon log file so the caller can include its tail
 * in error messages when the socket never becomes available.
 */
function launchDaemon(agentPath: string, socketPath: string, config: AgentConfig): string {
	const daemonArgs = [
		"--daemon",
		"--socket",
		socketPath,
		"--buffer-per-channel",
		String(config.bufferPerChannel),
		"--buffer-global",
		String(config.bufferGlobal),
	];

	const isBin = isAgentBinary(agentPath);
	const [cmd, args] = isBin
		? [agentPath, daemonArgs]
		: [process.execPath, [agentPath, ...daemonArgs]];

	const stateDir =
		process.platform === "win32"
			? join(process.env.LOCALAPPDATA ?? homedir(), "termora")
			: join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "termora");
	mkdirSync(stateDir, { recursive: true });

	// Ensure the socket's parent directory exists — on WSL / XDG_RUNTIME_DIR
	// environments the directory may not yet exist, causing the agent's
	// UnixListener::bind to fail with ENOENT and exit silently.
	// On win32 the socket path is a named pipe (\\.\pipe\...) which lives in the
	// kernel pipe namespace, not the filesystem — mkdirSync must be skipped there.
	// Gating on platform (not on the path string) is more robust: path-prefix
	// matching is case-sensitive and misses alternate pipe forms, while the
	// platform is the authoritative oracle for which path getSocketPath returns.
	if (process.platform !== "win32") {
		// mode: 0o700 makes the created dir owner-only so other local users
		// cannot reach the agent socket inside it.  Only applies to directories
		// CREATED by this call; pre-existing parents (e.g. /run/user/<uid>)
		// are untouched — matching the socket file's 0600 intent.
		mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
	}
	const logPath = join(stateDir, "agent-daemon.log");
	const logFd = openSync(logPath, "a");

	const child = spawn(cmd, args, {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		windowsHide: true,
	});

	child.on?.("error", (err) => {
		process.stderr.write(
			`[agent-launcher] daemon process error (pid=${child.pid}): ${err instanceof Error ? err.stack : String(err)}\n`,
		);
	});

	child.unref();
	try {
		closeSync(logFd);
	} catch {
		/* ignore */
	}

	return logPath;
}

/**
 * Read the last at-most `windowBytes` bytes of a log file and return the
 * last `maxLines` non-empty lines joined with newlines, capped at `maxChars`
 * characters.  Returns an empty string on ENOENT, empty file, or any error.
 *
 * Uses openSync/fstatSync/readSync/closeSync so the syscall sequence is
 * synchronous-bounded: only the suffix bytes are transferred, preventing
 * OOM or event-loop stall on large / hung daemon logs.
 *
 * @internal exported for unit testing
 */
export function readBoundedLogTail(
	logPath: string,
	windowBytes = 8192,
	maxLines = 20,
	maxChars = 4096,
): string {
	let fd = -1;
	try {
		fd = openSync(logPath, "r");
		const { size } = fstatSync(fd);
		if (size <= 0) return "";
		const readOffset = Math.max(0, size - windowBytes);
		const readLen = size - readOffset;
		const buf = Buffer.allocUnsafe(readLen);
		const bytesRead = readSync(fd, buf, 0, readLen, readOffset);
		const raw = buf.toString("utf8", 0, bytesRead);
		const lines = raw.split("\n").filter((l) => l.length > 0);
		const tail = lines.slice(-maxLines).join("\n");
		return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
	} catch {
		// ENOENT or unreadable — not fatal
		return "";
	} finally {
		if (fd !== -1) {
			try {
				closeSync(fd);
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * Poll for the socket to become available (agent has started listening).
 * Retries every AGENT_SOCKET_POLL_MS (100ms), gives up after AGENT_SOCKET_TIMEOUT (5s).
 *
 * On timeout, appends the last ~20 lines of the daemon log (if non-empty) to
 * the error message so startup crashes are not silent.
 */
async function waitForSocket(socketPath: string, daemonLogPath?: string): Promise<void> {
	const deadline = Date.now() + AGENT_SOCKET_TIMEOUT;

	while (Date.now() < deadline) {
		try {
			const isAlive = await probeSocket(socketPath);
			if (isAlive) return;
		} catch {
			// EACCES or transient error — wait and retry
		}

		await sleep(AGENT_SOCKET_POLL_MS);
	}

	// Build a diagnostic suffix from the daemon log tail (bounded to last 20 lines / 4 KB).
	let logTail = "";
	if (daemonLogPath) {
		const tail = readBoundedLogTail(daemonLogPath);
		if (tail.length > 0) {
			logTail = `\n\nAgent daemon log (last 20 lines from ${daemonLogPath}):\n${tail}`;
		}
	}

	throw new Error(
		`Agent socket did not become available within ${AGENT_SOCKET_TIMEOUT}ms: ${socketPath}${logTail}`,
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
