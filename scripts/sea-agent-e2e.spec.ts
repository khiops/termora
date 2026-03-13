/**
 * sea-agent-e2e.spec.ts
 *
 * End-to-end tests that validate the nexterm-agent SEA binary works correctly.
 *
 * Prerequisites:
 *   pnpm run package:sea-agent   (builds dist/sea/nexterm-agent)
 *
 * All tests skip gracefully when the binary has not been built yet.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
	accessSync,
	existsSync,
	constants as fsConstants,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FrameReader, encodeFrame } from "../packages/shared/src/framing.js";

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const SEA_BINARY = join(ROOT, "dist", "sea", "nexterm-agent");

/** Default spawn parameters — matches AgentSpawnMessage required fields. */
const DEFAULT_SPAWN_CWD = process.env["HOME"] ?? "/tmp";
const DEFAULT_SPAWN_ENV: Record<string, string> = {};

/** True when the SEA binary has been built and is executable. */
function isBinaryAvailable(): boolean {
	if (!existsSync(SEA_BINARY)) return false;
	try {
		accessSync(SEA_BINARY, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

const BINARY_AVAILABLE = isBinaryAvailable();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Spawn the agent in stdio mode. */
function spawnAgent(): ChildProcess {
	return spawn(SEA_BINARY, ["--stdio"], {
		stdio: ["pipe", "pipe", "inherit"],
	});
}

/** Write a length-prefixed MessagePack frame to the agent's stdin. */
function sendFrame(proc: ChildProcess, msg: object): void {
	const frame = encodeFrame(msg as Parameters<typeof encodeFrame>[0]);
	proc.stdin!.write(Buffer.from(frame));
}

/**
 * Build a SPAWN message with all required fields populated.
 * All fields match AgentSpawnMessage (camelCase — codec converts to snake_case).
 */
function makeSpawn(
	requestId: string,
	overrides?: Partial<{
		shell: string;
		cols: number;
		rows: number;
		cwd: string;
		env: Record<string, string>;
	}>,
): object {
	return {
		type: "SPAWN",
		requestId,
		shell: overrides?.shell ?? "/bin/sh",
		args: [],
		cwd: overrides?.cwd ?? DEFAULT_SPAWN_CWD,
		env: overrides?.env ?? DEFAULT_SPAWN_ENV,
		cols: overrides?.cols ?? 80,
		rows: overrides?.rows ?? 24,
	};
}

/**
 * Wait for a single message of the given type from a FrameReader-backed
 * stdout stream. Rejects on timeout.
 */
function waitForMessage(
	proc: ChildProcess,
	type: string,
	timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const reader = new FrameReader();
		const timer = setTimeout(() => {
			proc.stdout!.off("data", onData);
			reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${type}`));
		}, timeoutMs);

		function onData(chunk: Buffer): void {
			try {
				const messages = reader.push(chunk);
				for (const msg of messages) {
					const m = msg as Record<string, unknown>;
					if (m["type"] === type) {
						clearTimeout(timer);
						proc.stdout!.off("data", onData);
						resolve(m);
					}
				}
			} catch (err) {
				clearTimeout(timer);
				proc.stdout!.off("data", onData);
				reject(err);
			}
		}

		proc.stdout!.on("data", onData);
	});
}

/**
 * Collect all decoded messages from the agent's stdout into a live array.
 */
function collectMessages(proc: ChildProcess): {
	reader: FrameReader;
	messages: Record<string, unknown>[];
} {
	const reader = new FrameReader();
	const messages: Record<string, unknown>[] = [];

	proc.stdout!.on("data", (chunk: Buffer) => {
		try {
			const decoded = reader.push(chunk);
			for (const msg of decoded) {
				messages.push(msg as Record<string, unknown>);
			}
		} catch {
			// ignore decode errors in collection mode
		}
	});

	return { reader, messages };
}

/**
 * Wait for any message matching the predicate from a live-populated message
 * array. Polls with setImmediate until the timeout fires.
 */
function waitForPredicate(
	messages: Record<string, unknown>[],
	predicate: (m: Record<string, unknown>) => boolean,
	timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		let cursor = 0;

		function check(): void {
			while (cursor < messages.length) {
				const m = messages[cursor++]!;
				if (predicate(m)) {
					resolve(m);
					return;
				}
			}
			if (Date.now() >= deadline) {
				reject(
					new Error(
						`Timed out after ${timeoutMs}ms. Messages so far: ${JSON.stringify(messages.map((m) => m["type"]))}`,
					),
				);
				return;
			}
			setImmediate(check);
		}

		check();
	});
}

/** Check if an OUTPUT message's data field contains the given string. */
function outputContains(
	m: Record<string, unknown>,
	needle: string,
): boolean {
	if (m["type"] !== "OUTPUT") return false;
	const data = m["data"];
	if (typeof data === "string") return data.includes(needle);
	if (data instanceof Uint8Array)
		return Buffer.from(data).toString().includes(needle);
	return false;
}

/** Kill a child process and wait for it to exit. */
function killAgent(proc: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (proc.exitCode !== null) {
			resolve();
			return;
		}
		proc.once("exit", () => resolve());
		proc.kill("SIGTERM");
		// Force-kill after 3 s if SIGTERM is ignored
		setTimeout(() => {
			if (proc.exitCode === null) proc.kill("SIGKILL");
		}, 3_000);
	});
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe(
	"nexterm-agent SEA binary E2E",
	{ timeout: 30_000 },
	() => {
		let agent: ChildProcess | null = null;

		beforeEach(() => {
			agent = null;
		});

		afterEach(async () => {
			if (agent !== null) {
				await killAgent(agent);
				agent = null;
			}
		});

		// ── Test 1: binary exists and is executable ───────────────────────────

		it.skipIf(!BINARY_AVAILABLE)(
			"binary exists and is executable",
			() => {
				expect(existsSync(SEA_BINARY)).toBe(true);

				// Must be executable
				expect(() =>
					accessSync(SEA_BINARY, fsConstants.X_OK),
				).not.toThrow();

				// Must be > 10 MB (includes the Node.js runtime)
				const stat = statSync(SEA_BINARY);
				expect(stat.size).toBeGreaterThan(10 * 1024 * 1024);
			},
		);

		// ── Test 2: outputs HELLO on stdio ───────────────────────────────────

		it.skipIf(!BINARY_AVAILABLE)(
			"outputs HELLO on stdio with version and capabilities",
			async () => {
				agent = spawnAgent();

				const hello = await waitForMessage(agent, "HELLO", 10_000);

				expect(hello["type"]).toBe("HELLO");
				expect(hello["version"]).toBe(1);

				const capabilities = hello["capabilities"] as string[];
				expect(Array.isArray(capabilities)).toBe(true);
				expect(capabilities).toContain("multiplex");
				expect(capabilities).toContain("resize");
				expect(capabilities).toContain("snapshot");
			},
		);

		// ── Test 3: spawns PTY and produces output ────────────────────────────

		it.skipIf(!BINARY_AVAILABLE)(
			"spawns a PTY and echoes INPUT back via OUTPUT",
			async () => {
				agent = spawnAgent();
				const { messages } = collectMessages(agent);

				// Wait for HELLO
				await waitForPredicate(
					messages,
					(m) => m["type"] === "HELLO",
					10_000,
				);

				// Send SPAWN with all required fields
				sendFrame(agent, makeSpawn("e2e-test"));

				// Wait for SPAWN_OK
				const spawnOk = await waitForPredicate(
					messages,
					(m) => m["type"] === "SPAWN_OK" && m["requestId"] === "e2e-test",
					10_000,
				);
				const channelId = spawnOk["channelId"] as string;
				expect(typeof channelId).toBe("string");
				expect(channelId.length).toBeGreaterThan(0);

				// Send INPUT — echo a unique string
				sendFrame(agent, {
					type: "INPUT",
					channelId,
					data: "echo E2E_TEST_OK\n",
				});

				// Wait for OUTPUT containing our echo
				await waitForPredicate(
					messages,
					(m) => outputContains(m, "E2E_TEST_OK"),
					15_000,
				);

				// Send DESTROY
				sendFrame(agent, { type: "DESTROY", channelId });
			},
		);

		// ── Test 4: unknown message type does not crash the agent ────────────

		it.skipIf(!BINARY_AVAILABLE)(
			"handles unknown message type gracefully without crashing",
			async () => {
				agent = spawnAgent();

				// Wait for HELLO so the agent is fully up
				await waitForMessage(agent, "HELLO", 10_000);

				// Send an unknown message type
				sendFrame(agent, { type: "NONEXISTENT", data: "test" });

				// The agent must stay alive for at least 2 seconds
				const alive = await new Promise<boolean>((resolve) => {
					const earlyExit = (): void => resolve(false);
					agent!.once("exit", earlyExit);
					setTimeout(() => {
						agent!.off("exit", earlyExit);
						resolve(agent!.exitCode === null);
					}, 2_000);
				});

				expect(alive).toBe(true);
			},
		);

		// ── Test 5: pty.node addon is extracted to cache ──────────────────────

		it.skipIf(!BINARY_AVAILABLE)(
			"pty.node addon is extracted to cache dir after PTY spawn",
			async () => {
				agent = spawnAgent();
				const { messages } = collectMessages(agent);

				// Wait for HELLO
				await waitForPredicate(
					messages,
					(m) => m["type"] === "HELLO",
					10_000,
				);

				// Spawn a PTY to trigger addon extraction
				sendFrame(agent, makeSpawn("e2e-addon-test"));

				await waitForPredicate(
					messages,
					(m) =>
						m["type"] === "SPAWN_OK" &&
						m["requestId"] === "e2e-addon-test",
					10_000,
				);

				// Give the addon loader a moment to flush the cache write
				await new Promise((r) => setTimeout(r, 500));

				// Locate the cache dir: ~/.cache/nexterm/addons/<version>/pty.node
				const cacheBase =
					process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
				const agentPkgPath = join(
					ROOT,
					"packages",
					"agent",
					"package.json",
				);
				const agentPkg = JSON.parse(
					readFileSync(agentPkgPath, "utf8"),
				) as { version?: string };
				const version = agentPkg.version ?? "0.1.0";
				const ptyNodeCached = join(
					cacheBase,
					"nexterm",
					"addons",
					version,
					"pty.node",
				);

				expect(existsSync(ptyNodeCached)).toBe(true);

				// On Linux: first 4 bytes must be ELF magic (0x7f 45 4c 46)
				if (process.platform === "linux") {
					const bytes = readFileSync(ptyNodeCached);
					expect(bytes[0]).toBe(0x7f);
					expect(bytes[1]).toBe(0x45); // 'E'
					expect(bytes[2]).toBe(0x4c); // 'L'
					expect(bytes[3]).toBe(0x46); // 'F'
				}
			},
		);

		// ── Test 6: multiple PTY channels ────────────────────────────────────

		it.skipIf(!BINARY_AVAILABLE)(
			"handles multiple PTY channels concurrently",
			async () => {
				agent = spawnAgent();
				const { messages } = collectMessages(agent);

				// Wait for HELLO
				await waitForPredicate(
					messages,
					(m) => m["type"] === "HELLO",
					10_000,
				);

				// Spawn 3 channels
				const requestIds = ["multi-1", "multi-2", "multi-3"];
				for (const requestId of requestIds) {
					sendFrame(agent, makeSpawn(requestId));
				}

				// Collect all 3 SPAWN_OKs
				const channelIds: string[] = [];
				for (const requestId of requestIds) {
					const ok = await waitForPredicate(
						messages,
						(m) =>
							m["type"] === "SPAWN_OK" && m["requestId"] === requestId,
						10_000,
					);
					const channelId = ok["channelId"] as string;
					expect(typeof channelId).toBe("string");
					channelIds.push(channelId);
				}

				// All channel IDs must be unique
				const unique = new Set(channelIds);
				expect(unique.size).toBe(3);

				// Send unique INPUT to each channel and verify OUTPUT
				for (let i = 0; i < channelIds.length; i++) {
					const tag = `MULTI_TAG_${i}`;
					sendFrame(agent, {
						type: "INPUT",
						channelId: channelIds[i],
						data: `echo ${tag}\n`,
					});

					await waitForPredicate(
						messages,
						(m) =>
							m["channelId"] === channelIds[i] &&
							outputContains(m, tag),
						15_000,
					);
				}

				// Destroy all channels
				for (const channelId of channelIds) {
					sendFrame(agent, { type: "DESTROY", channelId });
				}
			},
		);
	},
);
