import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { FrameReader, PROTOCOL_VERSION } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonServer } from "./daemon.js";

const DEFAULT_CONFIG = {
	bufferPerChannel: 1024 * 1024,
	bufferGlobal: 20 * 1024 * 1024,
	logLevel: "info",
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
