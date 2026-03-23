import { spawn } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AGENT_SOCKET_POLL_MS,
	AGENT_SOCKET_TIMEOUT,
	type AgentConfig,
	probeSocket,
} from "@nexterm/shared";
import { detectSea } from "@nexterm/shared/dist/sea-addon-loader.js";
import { resolveAgentBinaryPath } from "../sea-agent-resolver.js";
import { NextermAgent } from "./nexterm-agent.js";

/**
 * Resolve the path to the agent binary.
 *
 * In SEA mode: looks for a co-located nexterm-agent binary next to the hub
 * executable. Falls back to PATH resolution via resolveAgentBinaryPath().
 *
 * In dev mode: returns the Rust agent binary built by cargo at
 *   <project-root>/target/release/nexterm-agent[.exe]
 */
export function resolveAgentPath(): string {
	const sea = detectSea();
	if (sea) {
		const seaPath = resolveAgentBinaryPath();
		if (seaPath) return seaPath;
	}
	// Dev mode fallback: Rust agent binary
	const __dirname = dirname(fileURLToPath(import.meta.url));
	// This file is at packages/hub/src/session/ — go up 5 levels to project root
	const ext = process.platform === "win32" ? ".exe" : "";
	return join(__dirname, "../../../../..", `target/release/nexterm-agent${ext}`);
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
 * 6. Connect via NextermAgent.connectLocal
 */
export async function connectOrLaunch(
	socketPath: string,
	config: AgentConfig,
	agentBinaryPath?: string,
): Promise<NextermAgent> {
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
		return await NextermAgent.connectLocal(socketPath);
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
	launchDaemon(agentPath, socketPath, config);

	// Wait for socket to become available
	await waitForSocket(socketPath);

	// Connect
	return NextermAgent.connectLocal(socketPath);
}

/**
 * Spawn the agent as a detached daemon process.
 * The process is unref'd so the hub can exit without waiting for it.
 *
 * SEA mode: the agent path is a self-contained executable — spawn directly.
 * Dev mode: the agent path is a JS file — spawn via node.
 */
function launchDaemon(agentPath: string, socketPath: string, config: AgentConfig): void {
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

	const child = spawn(cmd, args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});

	child.on?.("error", (err) => {
		process.stderr.write(
			`[agent-launcher] daemon process error (pid=${child.pid}): ${err instanceof Error ? err.stack : String(err)}\n`,
		);
	});

	child.unref();
}

/**
 * Poll for the socket to become available (agent has started listening).
 * Retries every AGENT_SOCKET_POLL_MS (100ms), gives up after AGENT_SOCKET_TIMEOUT (5s).
 */
async function waitForSocket(socketPath: string): Promise<void> {
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

	throw new Error(
		`Agent socket did not become available within ${AGENT_SOCKET_TIMEOUT}ms: ${socketPath}`,
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
