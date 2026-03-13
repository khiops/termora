import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostArch, HostOs } from "@nexterm/shared";
import type { SFTPWrapper, Client as SshClient } from "ssh2";
import { parseUnameOutput, parseWindowsArchOutput } from "./os-detect.js";
import type { OsDetectResult } from "./os-detect.js";
import { sshExec } from "./ssh-exec.js";

export type { OsDetectResult };

export interface DeployResult {
	/** true if a binary was uploaded (false = agent was already present) */
	deployed: boolean;
	/** path where agent is/was found on the remote host */
	remotePath: string;
	/** detected OS (null if the agent was already present or os was known) */
	os: HostOs | null;
	/** detected arch (null if the agent was already present or arch was known) */
	arch: HostArch | null;
}

/** Common paths to check when which/where are not available */
const COMMON_AGENT_PATHS_UNIX = [
	"~/.local/bin/nexterm-agent",
	"/usr/local/bin/nexterm-agent",
	"/usr/bin/nexterm-agent",
	"/opt/nexterm/nexterm-agent",
];

const COMMON_AGENT_PATHS_WINDOWS = [
	"%LOCALAPPDATA%\\nexterm\\nexterm-agent.exe",
	"%ProgramFiles%\\nexterm\\nexterm-agent.exe",
];

/**
 * Check if nexterm-agent exists on the remote host.
 * Returns the remote path if found, null otherwise.
 */
export async function checkRemoteAgent(client: SshClient): Promise<string | null> {
	// 1. Try which (Linux/macOS)
	try {
		const { stdout, exitCode } = await sshExec(client, "which nexterm-agent");
		if (exitCode === 0) {
			const p = stdout.trim();
			if (p) return p;
		}
	} catch {
		// ignore — fall through
	}

	// 2. Try where (Windows)
	try {
		const { stdout, exitCode } = await sshExec(client, "where nexterm-agent");
		if (exitCode === 0) {
			const firstLine = stdout.split(/\r?\n/)[0]?.trim();
			if (firstLine) return firstLine;
		}
	} catch {
		// ignore — fall through
	}

	// 3. Try common Unix paths via test -x
	for (const rawPath of COMMON_AGENT_PATHS_UNIX) {
		try {
			const { exitCode } = await sshExec(client, `test -x ${rawPath} && echo ok`);
			if (exitCode === 0) return rawPath;
		} catch {
			// ignore
		}
	}

	// 4. Try common Windows paths
	// NOTE: `if exist` is a cmd.exe built-in and will fail if the remote shell
	// is PowerShell. The `where` check above (step 2) already covers the common
	// case; this loop is a best-effort fallback for cmd.exe sessions only.
	for (const rawPath of COMMON_AGENT_PATHS_WINDOWS) {
		try {
			const { stdout, exitCode } = await sshExec(client, `if exist "${rawPath}" echo ok`);
			if (exitCode === 0 && stdout.trim() === "ok") return rawPath;
		} catch {
			// ignore
		}
	}

	return null;
}

/**
 * Detect OS and architecture of the remote host.
 * Tries uname -sm (Linux/macOS) first, then PROCESSOR_ARCHITECTURE (Windows).
 */
export async function detectRemoteOsArch(client: SshClient): Promise<OsDetectResult | null> {
	// 1. Try uname -sm (Linux / macOS)
	try {
		const { stdout, exitCode } = await sshExec(client, "uname -sm");
		if (exitCode === 0) {
			const result = parseUnameOutput(stdout);
			if (result) return result;
		}
	} catch {
		// ignore — Windows does not have uname
	}

	// 2. Try Windows PROCESSOR_ARCHITECTURE
	try {
		const { stdout, exitCode } = await sshExec(client, "echo %PROCESSOR_ARCHITECTURE%");
		if (exitCode === 0) {
			const result = parseWindowsArchOutput(stdout);
			if (result) return result;
		}
	} catch {
		// ignore
	}

	return null;
}

/**
 * Open an SFTP channel from the SSH client.
 * Returns the SFTPWrapper, which must be explicitly closed after use.
 */
function openSftp(client: SshClient): Promise<SFTPWrapper> {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) reject(err);
			else resolve(sftp);
		});
	});
}

/** mkdir -p via SFTP: creates dir and ignores EEXIST errors. */
function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
	return new Promise((resolve) => {
		sftp.mkdir(remotePath, (_err) => {
			// Swallow all errors: EEXIST is expected when the directory already
			// exists. Other errors (e.g. permission denied) will surface at
			// fastPut time, which provides a clearer message.
			resolve();
		});
	});
}

/** Upload a local file to a remote path via SFTP fastPut (streaming — handles large files). */
function sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.fastPut(localPath, remotePath, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

/** chmod a remote file via SFTP. */
function sftpChmod(sftp: SFTPWrapper, remotePath: string, mode: number): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.chmod(remotePath, mode, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

/**
 * Upload the agent binary to the remote host via SFTP.
 * Ensures the parent directory exists, uploads with fastPut (streaming),
 * then chmod 755 the binary.
 */
export async function uploadAgentBinary(
	client: SshClient,
	localPath: string,
	remotePath: string,
): Promise<void> {
	const sftp = await openSftp(client);
	try {
		// Ensure parent directory exists (ignore failures — will fail at fastPut if real error)
		const parentDir = remotePath.includes("/")
			? remotePath.slice(0, remotePath.lastIndexOf("/"))
			: remotePath.includes("\\")
				? remotePath.slice(0, remotePath.lastIndexOf("\\"))
				: ".";
		if (parentDir && parentDir !== ".") {
			await sftpMkdir(sftp, parentDir);
		}

		// Upload binary using fastPut (streaming — handles large binaries ~120 MB)
		await sftpFastPut(sftp, localPath, remotePath);

		// Make executable (chmod 755) — no-op on Windows but harmless
		await sftpChmod(sftp, remotePath, 0o755);
	} finally {
		sftp.end();
	}
}

/**
 * Resolve the remote home directory by running echo $HOME via SSH.
 * Falls back to "~" if the command fails or returns the literal $HOME.
 */
async function resolveRemoteHome(client: SshClient): Promise<string> {
	try {
		const { stdout, exitCode } = await sshExec(client, "echo $HOME");
		if (exitCode === 0) {
			const home = stdout.trim();
			if (home && home !== "$HOME") return home;
		}
	} catch {
		// ignore
	}
	return "~";
}

/**
 * Determine the remote install path for the agent binary.
 * Expands ~ using the actual remote home directory.
 */
async function resolveRemotePath(client: SshClient, os: HostOs): Promise<string> {
	if (os === "windows") {
		return "%LOCALAPPDATA%\\nexterm\\nexterm-agent.exe";
	}
	const home = await resolveRemoteHome(client);
	return `${home}/.local/bin/nexterm-agent`;
}

/**
 * Full auto-deploy flow.
 *
 * 1. Check if nexterm-agent is already on the remote host.
 * 2. If not found, detect OS/arch (or use known values from host record).
 * 3. Locate the correct pre-built binary in the local binary cache.
 * 4. Upload via SFTP.
 *
 * Auto-deploy is best-effort — callers should catch errors and fall back
 * to attempting nexterm-agent --stdio directly.
 */
export async function deployAgentIfNeeded(
	client: SshClient,
	host: { os: HostOs | null; arch: HostArch | null },
	binaryCache: string,
): Promise<DeployResult> {
	// 1. Check if agent is already present
	const existingPath = await checkRemoteAgent(client);
	if (existingPath) {
		return { deployed: false, remotePath: existingPath, os: null, arch: null };
	}

	// 2. Detect OS/arch if not already known from the host record
	let os = host.os;
	let arch = host.arch;
	if (!os || !arch) {
		const detected = await detectRemoteOsArch(client);
		if (!detected) {
			throw new Error(
				"Cannot detect remote OS/arch for agent deployment. " +
					"Set os/arch on the host manually or check SSH connectivity.",
			);
		}
		os = detected.os;
		arch = detected.arch;
	}

	// 3. Locate the binary in the local cache
	const binaryName =
		os === "windows" ? `nexterm-agent-${os}-${arch}.exe` : `nexterm-agent-${os}-${arch}`;
	const localBinary = join(binaryCache, binaryName);
	if (!existsSync(localBinary)) {
		throw new Error(
			`Agent binary not found in cache: ${localBinary}. ` +
				"Build it or copy it to the binary cache (see docs/MVP_ROADMAP.md).",
		);
	}

	// 4. Determine remote install path (expands ~ using remote $HOME)
	const remotePath = await resolveRemotePath(client, os);

	// 5. Upload via SFTP (fastPut handles large binaries efficiently)
	await uploadAgentBinary(client, localBinary, remotePath);

	return { deployed: true, remotePath, os, arch };
}

/**
 * Return the path to the binary cache directory inside the hub state dir.
 * Uses the same XDG / platform-aware logic as getStateDir() in cli.ts.
 */
export function getBinaryCacheDir(): string {
	if (process.platform === "win32") {
		return join(process.env.LOCALAPPDATA ?? "", "nexterm", "binaries");
	}
	const stateBase = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
	return join(stateBase, "nexterm", "binaries");
}
