import { EventEmitter } from "node:events";
import type { Client as SshClient } from "ssh2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sshExec } from "./ssh-exec.js";

// ─── Mock SSH stream ──────────────────────────────────────────────────────────

class MockSshStream extends EventEmitter {
	readonly stderr = new EventEmitter();

	simulateOutput(stdout: string, stderr: string, exitCode: number): void {
		if (stdout) this.emit("data", Buffer.from(stdout));
		if (stderr) this.stderr.emit("data", Buffer.from(stderr));
		this.emit("close", exitCode);
	}

	simulateError(err: Error): void {
		this.emit("error", err);
	}
}

// ─── Mock SSH client ──────────────────────────────────────────────────────────

function makeMockClient(stream: MockSshStream | null, execErr?: Error): SshClient {
	return {
		exec: vi.fn((_command: string, cb: (err: Error | undefined, stream: MockSshStream) => void) => {
			if (execErr) {
				cb(execErr, null as unknown as MockSshStream);
				return;
			}
			// biome-ignore lint/style/noNonNullAssertion: stream is guaranteed non-null here; the null branch returns early above
			cb(undefined, stream!);
		}),
	} as unknown as SshClient;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sshExec", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves with stdout, stderr, and exitCode=0 on success", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "echo hello");
		stream.simulateOutput("hello\n", "", 0);

		const result = await promise;
		expect(result.stdout).toBe("hello\n");
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	});

	it("captures stderr output", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "ls /no-such-dir");
		stream.simulateOutput("", "ls: cannot access '/no-such-dir': No such file or directory\n", 2);

		const result = await promise;
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("No such file or directory");
		expect(result.exitCode).toBe(2);
	});

	it("resolves with exitCode=1 when stream closes with null code", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "signal-killed-cmd");
		// Simulate stream close with null (signal-killed process) — synchronous emit
		// because fake timers intercept setImmediate
		stream.emit("close", null);

		const result = await promise;
		expect(result.exitCode).toBe(1);
	});

	it("rejects when ssh2 exec returns an error", async () => {
		const execErr = new Error("SSH channel open failed");
		const client = makeMockClient(null, execErr);

		await expect(sshExec(client, "any-cmd")).rejects.toThrow("SSH channel open failed");
	});

	it("rejects when stream emits an error event", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "cmd");
		// Synchronous emit — fake timers intercept setImmediate
		stream.simulateError(new Error("stream read error"));

		await expect(promise).rejects.toThrow("stream read error");
	});

	it("rejects on timeout and clears the timer", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "hanging-cmd", 500);
		// Advance timers past the timeout without resolving the stream
		vi.advanceTimersByTime(600);

		await expect(promise).rejects.toThrow("SSH exec timed out after 500ms: hanging-cmd");
	});

	it("concatenates multiple data chunks into a single stdout string", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "cat large-file");
		stream.emit("data", Buffer.from("chunk1"));
		stream.emit("data", Buffer.from("chunk2"));
		stream.emit("data", Buffer.from("chunk3"));
		stream.emit("close", 0);

		const result = await promise;
		expect(result.stdout).toBe("chunk1chunk2chunk3");
	});

	it("does not reject twice when both close and error fire", async () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		const promise = sshExec(client, "cmd");
		stream.emit("close", 0);
		// Subsequent error should be ignored (already settled)
		stream.emit("error", new Error("late error"));

		const result = await promise;
		expect(result.exitCode).toBe(0);
	});

	it("uses the default 10-second timeout when none is specified", () => {
		const stream = new MockSshStream();
		const client = makeMockClient(stream);

		// Just verify the call doesn't reject immediately — timer would fire at 10s
		const promise = sshExec(client, "slow-cmd");

		// Advance by 9 seconds — should still be pending
		vi.advanceTimersByTime(9_000);

		// Resolve to avoid hanging test
		stream.simulateOutput("done", "", 0);
		return expect(promise).resolves.toMatchObject({ exitCode: 0 });
	});
});
