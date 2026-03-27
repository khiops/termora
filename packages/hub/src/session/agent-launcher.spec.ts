import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
	type AgentConfig,
	DEFAULT_AGENT_CONFIG,
	PROTOCOL_VERSION,
	encodeFrame,
} from "@nexterm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextermAgent } from "./nexterm-agent.js";
import { getTestSocketPath } from "./test-socket-path.js";

/**
 * Mock child_process.spawn so connectOrLaunch never creates real processes.
 * The mock's behavior is configured per-test via mockSpawnImpl.
 */
let mockSpawnImpl: (...args: unknown[]) => unknown = () => ({
	unref: vi.fn(),
	pid: 99999,
});

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (...args: unknown[]) => mockSpawnImpl(...args),
	};
});

// Import AFTER vi.mock so the mock is in place
const { connectOrLaunch } = await import("./agent-launcher.js");

const TEST_TIMEOUT = 15_000;

/**
 * Create a mock agent daemon that speaks the nexterm protocol.
 * On each connection it sends HELLO + CHANNEL_STATE_END immediately.
 */
function createMockDaemon(socketPath: string): Promise<{
	server: net.Server;
	connections: net.Socket[];
}> {
	return new Promise((resolve) => {
		const connections: net.Socket[] = [];

		const server = net.createServer((socket) => {
			connections.push(socket);
			socket.on("error", () => {}); // suppress ECONNRESET during cleanup

			const hello = encodeFrame({
				type: "HELLO",
				version: PROTOCOL_VERSION,
				agentVersion: "0.1.0",
				capabilities: ["multiplex", "resize", "snapshot"],
			});
			socket.write(Buffer.from(hello));

			const end = encodeFrame({ type: "CHANNEL_STATE_END" });
			socket.write(Buffer.from(end));
		});

		server.listen(socketPath, () => resolve({ server, connections }));
	});
}

/** Close a net.Server and wait for the "close" event. */
function closeServer(server: net.Server): Promise<void> {
	return new Promise((resolve) => {
		server.close(() => resolve());
	});
}

describe("connectOrLaunch", () => {
	let tmpDir: string;
	let socketPath: string;
	let daemon: { server: net.Server; connections: net.Socket[] } | null = null;
	let agent: NextermAgent | null = null;

	const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG };

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "nexterm-launcher-test-"));
		socketPath = getTestSocketPath();

		// Reset spawn mock to default (no-op)
		mockSpawnImpl = () => ({ unref: vi.fn(), pid: 99999 });
	});

	afterEach(async () => {
		agent?.close();
		agent = null;
		if (daemon) {
			for (const conn of daemon.connections) {
				conn.destroy();
			}
			await closeServer(daemon.server);
			daemon = null;
		}
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("Given agent daemon already running", () => {
		it(
			"connects to existing agent without spawning",
			async () => {
				daemon = await createMockDaemon(socketPath);

				// Binary must exist to pass access() check, but won't be spawned
				const dummyBinary = path.join(tmpDir, "fake-agent.js");
				await writeFile(dummyBinary, "// placeholder");

				let spawnCalled = false;
				mockSpawnImpl = () => {
					spawnCalled = true;
					return { unref: vi.fn(), pid: 99999 };
				};

				agent = await connectOrLaunch(socketPath, config, dummyBinary);

				expect(agent).toBeDefined();
				expect(agent.connected).toBe(true);
				expect(spawnCalled).toBe(false);
			},
			TEST_TIMEOUT,
		);
	});

	describe.skipIf(process.platform === "win32")("Given stale socket file", () => {
		it(
			"unlinks stale socket and connects to newly started daemon",
			async () => {
				// Create a server, then close it to leave a stale socket file
				const staleServer = net.createServer();
				await new Promise<void>((resolve) => {
					staleServer.listen(socketPath, () => resolve());
				});
				await closeServer(staleServer);

				// probeSocket returns false (ECONNREFUSED) for the stale socket.
				// connectOrLaunch will unlink it, call spawn, then poll for socket.
				// Our mock spawn starts the mock daemon instead of a real process.
				mockSpawnImpl = () => {
					setImmediate(async () => {
						daemon = await createMockDaemon(socketPath);
					});
					return { unref: vi.fn(), pid: 12345 };
				};

				const dummyBinary = path.join(tmpDir, "fake-agent.js");
				await writeFile(dummyBinary, "// placeholder");

				agent = await connectOrLaunch(socketPath, config, dummyBinary);

				expect(agent).toBeDefined();
				expect(agent.connected).toBe(true);
			},
			TEST_TIMEOUT,
		);
	});

	describe("Given no agent running (ENOENT)", () => {
		it(
			"spawns daemon and connects after socket becomes available",
			async () => {
				let capturedArgs: unknown[] = [];

				// Mock spawn: start mock daemon after a delay (simulates startup time)
				mockSpawnImpl = (...args: unknown[]) => {
					capturedArgs = args;
					setTimeout(async () => {
						daemon = await createMockDaemon(socketPath);
					}, 150);
					return { unref: vi.fn(), pid: 12345 };
				};

				const dummyBinary = path.join(tmpDir, "fake-agent.js");
				await writeFile(dummyBinary, "// placeholder");

				agent = await connectOrLaunch(socketPath, config, dummyBinary);

				expect(agent).toBeDefined();
				expect(agent.connected).toBe(true);

				// Verify spawn was called with correct arguments
				expect(capturedArgs[0]).toBe(process.execPath);
				const cliArgs = capturedArgs[1] as string[];
				expect(cliArgs).toContain("--daemon");
				expect(cliArgs).toContain("--socket");
				expect(cliArgs).toContain(socketPath);
				expect(cliArgs).toContain("--buffer-per-channel");
				expect(cliArgs).toContain(String(config.bufferPerChannel));
				expect(cliArgs).toContain("--buffer-global");
				expect(cliArgs).toContain(String(config.bufferGlobal));

				// Verify detached + stdio: stdin=ignore, stdout+stderr=log fd
				const opts = capturedArgs[2] as Record<string, unknown>;
				expect(opts.detached).toBe(true);
				const stdio = opts.stdio as unknown[];
				expect(Array.isArray(stdio)).toBe(true);
				expect(stdio[0]).toBe("ignore");
				expect(typeof stdio[1]).toBe("number"); // log fd
				expect(stdio[1]).toBe(stdio[2]); // stdout and stderr share the same fd
			},
			TEST_TIMEOUT,
		);
	});

	describe("Given agent spawned but socket never becomes available", () => {
		it(
			"rejects with timeout error after AGENT_SOCKET_TIMEOUT",
			async () => {
				const dummyBinary = path.join(tmpDir, "fake-agent.js");
				await writeFile(dummyBinary, "// placeholder");

				// Spawn succeeds but never creates a real daemon — socket stays unavailable
				mockSpawnImpl = () => ({ unref: vi.fn(), pid: 77777 });

				await expect(connectOrLaunch(socketPath, config, dummyBinary)).rejects.toThrow(
					/Agent socket did not become available/,
				);
			},
			TEST_TIMEOUT,
		);
	});

	describe("Given agent binary does not exist", () => {
		it(
			"throws with descriptive error",
			async () => {
				const nonexistentPath = path.join(tmpDir, "nonexistent", "agent.js");

				await expect(connectOrLaunch(socketPath, config, nonexistentPath)).rejects.toThrow(
					/Agent binary not found/,
				);
			},
			TEST_TIMEOUT,
		);
	});

	describe("Given SEA binary path (no .js extension)", () => {
		it(
			"spawns the binary directly as the executable (not via node)",
			async () => {
				let capturedArgs: unknown[] = [];

				mockSpawnImpl = (...args: unknown[]) => {
					capturedArgs = args;
					setTimeout(async () => {
						daemon = await createMockDaemon(socketPath);
					}, 150);
					return { unref: vi.fn(), pid: 12345 };
				};

				// Create a fake SEA binary (no .js extension)
				const seaBinary = path.join(tmpDir, "nexterm-agent");
				await writeFile(seaBinary, "#!/bin/sh\n");

				agent = await connectOrLaunch(socketPath, config, seaBinary);

				expect(agent).toBeDefined();
				expect(agent.connected).toBe(true);

				// SEA binary must be the executable, not wrapped in node
				expect(capturedArgs[0]).toBe(seaBinary);
				const cliArgs = capturedArgs[1] as string[];
				// The binary path must NOT appear in the args list — it is the command
				expect(cliArgs).not.toContain(seaBinary);
				expect(cliArgs).toContain("--daemon");
				expect(cliArgs).toContain("--socket");
				expect(cliArgs).toContain(socketPath);
			},
			TEST_TIMEOUT,
		);
	});
});
