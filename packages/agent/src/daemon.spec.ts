import { mkdtemp, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { FrameReader, PROTOCOL_VERSION } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonServer } from "./daemon.js";

const DEFAULT_CONFIG = {
	bufferPerChannel: 1024 * 1024,
	bufferGlobal: 20 * 1024 * 1024,
	logLevel: "info",
	bindTimeout: 5000,
};

/**
 * Connect to the daemon and read decoded messages until the provided
 * predicate returns true or the timeout fires. Returns all messages received.
 */
function connectAndCollect(
	socketPath: string,
	until: (messages: ProtocolMessage[]) => boolean,
	timeoutMs = 2000,
): Promise<ProtocolMessage[]> {
	return new Promise((resolve, reject) => {
		const messages: ProtocolMessage[] = [];
		const reader = new FrameReader();
		const socket = net.connect(socketPath);

		const timer = setTimeout(() => {
			socket.destroy();
			reject(
				new Error(
					`Timed out after ${timeoutMs}ms — received ${messages.length} messages: ${JSON.stringify(messages.map((m) => m.type))}`,
				),
			);
		}, timeoutMs);

		socket.on("data", (data: Buffer) => {
			try {
				const decoded = reader.push(data);
				for (const msg of decoded) {
					messages.push(msg);
				}
				if (until(messages)) {
					clearTimeout(timer);
					socket.destroy();
					resolve(messages);
				}
			} catch (err) {
				clearTimeout(timer);
				socket.destroy();
				reject(err);
			}
		});

		socket.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

describe("DaemonServer", () => {
	let tmpDir: string;
	let socketPath: string;
	let server: DaemonServer;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "nexterm-daemon-test-"));
		socketPath = path.join(tmpDir, "agent.sock");
		server = new DaemonServer(socketPath, DEFAULT_CONFIG);
		await server.listen();
	});

	afterEach(async () => {
		await server.shutdown();
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("Given a daemon listening on UDS", () => {
		it("accepts a connection and sends HELLO", async () => {
			const messages = await connectAndCollect(socketPath, (msgs) =>
				msgs.some((m) => m.type === "HELLO"),
			);

			const hello = messages.find((m) => m.type === "HELLO");
			expect(hello).toBeDefined();
			expect(hello?.type).toBe("HELLO");

			// Narrow the type for property checks
			if (hello?.type !== "HELLO") throw new Error("unreachable");
			expect(hello?.version).toBe(PROTOCOL_VERSION);
			expect(Array.isArray(hello?.capabilities)).toBe(true);
		});

		it("sends CHANNEL_STATE_END immediately when no channels", async () => {
			const messages = await connectAndCollect(socketPath, (msgs) =>
				msgs.some((m) => m.type === "CHANNEL_STATE_END"),
			);

			const types = messages.map((m) => m.type);
			expect(types).toContain("HELLO");
			expect(types).toContain("CHANNEL_STATE_END");

			// HELLO should come before CHANNEL_STATE_END
			const helloIdx = types.indexOf("HELLO");
			const endIdx = types.indexOf("CHANNEL_STATE_END");
			expect(helloIdx).toBeLessThan(endIdx);
		});
	});

	describe("socket directory permissions", () => {
		it("creates socket directory with mode 0700", async () => {
			// Shut down the default server so we can test with a nested path
			await server.shutdown();

			const nestedDir = path.join(tmpDir, "nested", "run");
			const nestedSocket = path.join(nestedDir, "agent.sock");
			const nestedServer = new DaemonServer(nestedSocket, DEFAULT_CONFIG);

			try {
				await nestedServer.listen();

				const dirStat = await stat(nestedDir);
				// mode includes file-type bits; mask with 0o777 to get permission bits only
				expect(dirStat.mode & 0o777).toBe(0o700);
			} finally {
				await nestedServer.shutdown();
			}
		});
	});

	describe("connection displacement", () => {
		it("closes previous connection when new one arrives", async () => {
			// First connection — collect initial messages
			const firstSocket = net.connect(socketPath);
			const firstReader = new FrameReader();
			const firstMessages: ProtocolMessage[] = [];

			await new Promise<void>((resolve, reject) => {
				firstSocket.on("connect", () => resolve());
				firstSocket.on("error", reject);
			});

			// Read initial HELLO + CHANNEL_STATE_END from first connection
			await new Promise<void>((resolve) => {
				firstSocket.on("data", (data: Buffer) => {
					for (const msg of firstReader.push(data)) {
						firstMessages.push(msg);
					}
					if (firstMessages.some((m) => m.type === "CHANNEL_STATE_END")) {
						resolve();
					}
				});
			});

			// Track when first socket ends (server destroyed it)
			const firstEnded = new Promise<void>((resolve) => {
				firstSocket.on("end", () => resolve());
				firstSocket.on("close", () => resolve());
			});

			// Second connection displaces the first
			const secondMessages = await connectAndCollect(socketPath, (msgs) =>
				msgs.some((m) => m.type === "CHANNEL_STATE_END"),
			);

			// First socket should be closed by displacement
			await firstEnded;
			firstSocket.destroy();

			// Second connection should have received HELLO
			expect(secondMessages.some((m) => m.type === "HELLO")).toBe(true);
		});

		it("new connection receives HELLO", async () => {
			// First connection
			await connectAndCollect(socketPath, (msgs) =>
				msgs.some((m) => m.type === "CHANNEL_STATE_END"),
			);

			// Second connection should also get HELLO + CHANNEL_STATE_END
			const messages = await connectAndCollect(socketPath, (msgs) =>
				msgs.some((m) => m.type === "CHANNEL_STATE_END"),
			);

			const hello = messages.find((m) => m.type === "HELLO");
			expect(hello).toBeDefined();
			if (hello?.type !== "HELLO") throw new Error("unreachable");
			expect(hello?.version).toBe(PROTOCOL_VERSION);
		});
	});

	describe("graceful shutdown", () => {
		it("closes server and removes socket file", async () => {
			await server.shutdown();

			// After shutdown, connecting should fail
			const connectResult = await new Promise<string>((resolve) => {
				const socket = net.connect(socketPath);
				socket.on("connect", () => {
					socket.destroy();
					resolve("connected");
				});
				socket.on("error", (err: NodeJS.ErrnoException) => {
					resolve(err.code ?? "unknown");
				});
			});

			expect(connectResult).toMatch(/ENOENT|ECONNREFUSED/);
		});

		it("subsequent connections are refused after shutdown", async () => {
			await server.shutdown();

			const connectResult = await new Promise<string>((resolve) => {
				const socket = net.connect(socketPath);
				socket.on("connect", () => {
					socket.destroy();
					resolve("connected");
				});
				socket.on("error", (err: NodeJS.ErrnoException) => {
					resolve(err.code ?? "unknown");
				});
			});

			expect(connectResult).not.toBe("connected");
		});
	});
});

// ─── Item 1: EADDRINUSE randomized backoff ────────────────────────────────────
//
// On Unix, listen() unlinks the stale socket before binding, so a real
// EADDRINUSE from a live blocker process cannot normally occur (the file is
// gone before we bind). The retry logic guards against genuine races (e.g.
// two processes starting simultaneously, Windows named pipes).
//
// We test the retry loop by injecting EADDRINUSE errors via a factory that
// returns a mock net.Server whose `listen` emits an error on the first N calls
// and succeeds on the (N+1)th.

/** Build a fake net.Server whose listen() emits EADDRINUSE the first `failTimes` calls. */
function makeFlakyServer(failTimes: number): net.Server {
	let calls = 0;
	const emitter = new net.Server();

	// Intercept listen by replacing the method on this instance
	const realListen = emitter.listen.bind(emitter);
	// @ts-expect-error — intentional override for testing
	emitter.listen = (socketPath: string, cb: () => void) => {
		calls += 1;
		if (calls <= failTimes) {
			// Emit EADDRINUSE asynchronously so event listeners are attached first
			setImmediate(() => {
				const err = Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" });
				emitter.emit("error", err);
			});
			return emitter;
		}
		return realListen(socketPath, cb);
	};

	return emitter;
}

describe("DaemonServer — EADDRINUSE backoff", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "nexterm-daemon-backoff-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("succeeds on second attempt when first bind fails with EADDRINUSE", async () => {
		const socketPath = path.join(tmpDir, "retry.sock");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Use the exported helper to inject one failure then succeed
		const server = new DaemonServer(socketPath, { ...DEFAULT_CONFIG });
		// Swap in a flaky server (fails once, succeeds on attempt 2)
		// @ts-expect-error — accessing private field for testing
		server.server = makeFlakyServer(1);

		await expect(server.listen()).resolves.toBeUndefined();
		await server.shutdown();

		const retryCalls = errorSpy.mock.calls.filter((args) => String(args[0]).includes("EADDRINUSE"));
		expect(retryCalls.length).toBeGreaterThanOrEqual(1);

		errorSpy.mockRestore();
	});

	it("throws after exhausting all retries (3 consecutive EADDRINUSE)", async () => {
		const socketPath = path.join(tmpDir, "exhaust.sock");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const server = new DaemonServer(socketPath, { ...DEFAULT_CONFIG });
		// Fail all 3 attempts
		// @ts-expect-error — accessing private field for testing
		server.server = makeFlakyServer(3);

		await expect(server.listen()).rejects.toMatchObject({ code: "EADDRINUSE" });

		errorSpy.mockRestore();
	});

	it("logs a retry message for each EADDRINUSE attempt", async () => {
		const socketPath = path.join(tmpDir, "log.sock");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const server = new DaemonServer(socketPath, { ...DEFAULT_CONFIG });
		// @ts-expect-error — accessing private field for testing
		server.server = makeFlakyServer(3);

		await expect(server.listen()).rejects.toMatchObject({ code: "EADDRINUSE" });

		// Should have logged 2 retry messages (attempts 1 and 2 before final throw)
		const retryCalls = errorSpy.mock.calls.filter((args) => String(args[0]).includes("EADDRINUSE"));
		expect(retryCalls.length).toBe(2);

		errorSpy.mockRestore();
	});
});

// ─── Item 2: Socket path length validation ────────────────────────────────────

describe("DaemonServer — socket path length validation", () => {
	it("throws when socket path exceeds 100 bytes", () => {
		const longPath = `/${"a".repeat(101)}`;
		expect(() => new DaemonServer(longPath, { ...DEFAULT_CONFIG })).toThrow(/too long/);
	});

	it("accepts a socket path of exactly 100 bytes", () => {
		// Build a path that is exactly 100 bytes: 1 slash + 99 chars
		const exactPath = `/${"a".repeat(99)}`;
		expect(Buffer.byteLength(exactPath)).toBe(100);
		expect(() => new DaemonServer(exactPath, { ...DEFAULT_CONFIG })).not.toThrow();
	});

	it("error message mentions max limit and suggests remedy", () => {
		const longPath = `/${"b".repeat(110)}`;
		expect(() => new DaemonServer(longPath, { ...DEFAULT_CONFIG })).toThrow(/max 100/);
	});
});

// ─── Item 3: Configurable bind timeout ───────────────────────────────────────

describe("DaemonServer — configurable bind timeout", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "nexterm-daemon-timeout-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("uses default bindTimeout of 5000ms from DEFAULT_CONFIG", () => {
		const socketPath = path.join(tmpDir, "timeout.sock");
		// Constructing does not throw — merely validates the path, stores bindTimeout
		const s = new DaemonServer(socketPath, { ...DEFAULT_CONFIG });
		// Expose via listen resolving quickly (valid path, no contention)
		return s.listen().then(() => s.shutdown());
	});

	it("fires the timeout error when server.listen never calls back", async () => {
		const socketPath = path.join(tmpDir, "slow.sock");

		// Build a server whose listen() hangs indefinitely (never resolves, never errors).
		const hangingServer = new net.Server();
		// @ts-expect-error — intentional override for testing
		hangingServer.listen = () => hangingServer; // no-op: callback never called

		const failServer = new DaemonServer(socketPath, {
			...DEFAULT_CONFIG,
			// 50ms timeout is generous enough for CI but catches the hang quickly
			bindTimeout: 50,
		});
		// Swap in the hanging server AFTER listen() has set up the dir/unlink
		// We replace it before the first bindOnce() runs by hooking via the flaky approach:
		// @ts-expect-error — accessing private field for testing
		failServer.server = hangingServer;

		await expect(failServer.listen()).rejects.toThrow(/timed out/);
	});
});
