import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSocketPath, probeSocket } from "./socket-path.js";

describe("getSocketPath", () => {
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
		process.env = { ...originalEnv };
		vi.restoreAllMocks();
	});

	describe("on Linux/macOS", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "linux" });
		});

		it("returns XDG_RUNTIME_DIR path when set", () => {
			process.env.XDG_RUNTIME_DIR = "/run/user/1000";

			const result = getSocketPath();

			expect(result).toBe("/run/user/1000/nexterm/agent.sock");
		});

		it("returns /tmp fallback when XDG_RUNTIME_DIR unset", () => {
			process.env.XDG_RUNTIME_DIR = undefined;
			vi.spyOn(os, "userInfo").mockReturnValue({
				uid: 1234,
				gid: 1234,
				username: "testuser",
				homedir: "/home/testuser",
				shell: "/bin/bash",
			});

			const result = getSocketPath();

			expect(result).toBe("/tmp/nexterm-1234/agent.sock");
		});

		it("returns override path when provided", () => {
			const result = getSocketPath("/custom/path/agent.sock");

			expect(result).toBe("/custom/path/agent.sock");
		});
	});

	describe("on Windows", () => {
		it("returns named pipe path with username", () => {
			Object.defineProperty(process, "platform", { value: "win32" });
			vi.spyOn(os, "userInfo").mockReturnValue({
				uid: -1,
				gid: -1,
				username: "alice",
				homedir: "C:\\Users\\alice",
				shell: null,
			});

			const result = getSocketPath();

			expect(result).toBe("\\\\.\\pipe\\nexterm-agent-alice");
		});
	});
});

describe("probeSocket", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "nexterm-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("Given a listening server", () => {
		it("returns true", async () => {
			const socketPath = path.join(tmpDir, "test.sock");
			const server = net.createServer();

			await new Promise<void>((resolve) => {
				server.listen(socketPath, () => resolve());
			});

			try {
				const result = await probeSocket(socketPath);
				expect(result).toBe(true);
			} finally {
				await new Promise<void>((resolve) => {
					server.close(() => resolve());
				});
			}
		});
	});

	describe("Given no server (ENOENT)", () => {
		it("returns false", async () => {
			const socketPath = path.join(tmpDir, "nonexistent.sock");

			const result = await probeSocket(socketPath);

			expect(result).toBe(false);
		});
	});

	describe("Given a stale socket (ECONNREFUSED)", () => {
		it("returns false", async () => {
			const socketPath = path.join(tmpDir, "stale.sock");
			const server = net.createServer();

			// Create a real socket file then close the server to make it stale
			await new Promise<void>((resolve) => {
				server.listen(socketPath, () => resolve());
			});
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});

			const result = await probeSocket(socketPath);

			expect(result).toBe(false);
		});
	});
});
