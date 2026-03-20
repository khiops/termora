import { spawn } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import {
	AGENT_SOCKET_POLL_MS,
	AGENT_SOCKET_TIMEOUT,
	type AgentConfig,
	probeSocket,
} from "@nexterm/shared";
import { isAgentBinary, resolveAgentPath } from "./local-agent.js";
import { NextermAgent } from "./nexterm-agent.js";

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
	console.log(`[agent-launcher] connectOrLaunch: socketPath=${socketPath} agentPath=${agentPath}`);

	// Verify agent binary exists
	try {
		await access(agentPath);
		console.log(`[agent-launcher] connectOrLaunch: agent binary accessible`);
	} catch (err) {
		console.log(`[agent-launcher] connectOrLaunch: agent binary NOT accessible: ${err instanceof Error ? err.message : String(err)}`);
		throw new Error(`Agent binary not found: ${agentPath}`);
	}

	// Probe existing socket — EACCES propagates (different user's socket)
	const alive = await probeSocket(socketPath);
	console.log(`[agent-launcher] connectOrLaunch: socket probe result alive=${alive}`);

	if (alive) {
		// Agent already running — connect directly
		console.log(`[agent-launcher] connectOrLaunch: daemon already running, connecting to socket`);
		return NextermAgent.connectLocal(socketPath);
	}

	// Socket not alive — clean up stale file if present
	try {
		await unlink(socketPath);
		console.log(`[agent-launcher] connectOrLaunch: removed stale socket file`);
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

	console.log(`[agent-launcher] launchDaemon: cmd=${cmd} args=${JSON.stringify(args)} isBinary=${isBin}`);
	const child = spawn(cmd, args, {
		detached: true,
		stdio: "ignore",
	});
	console.log(`[agent-launcher] launchDaemon: daemon spawned pid=${child.pid}`);

	child.on?.("error", (err) => {
		console.log(`[agent-launcher] launchDaemon: daemon process error: ${err instanceof Error ? err.stack : String(err)}`);
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
