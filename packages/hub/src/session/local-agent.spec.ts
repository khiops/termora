import { existsSync } from "node:fs";
import type { ProtocolMessage } from "@nexterm/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LocalAgent, isAgentBinary, resolveAgentPath } from "./local-agent.js";

const AGENT_PATH = resolveAgentPath();
const TEST_TIMEOUT = 10_000;

describe("isAgentBinary", () => {
	it("returns false for .js paths", () => {
		expect(isAgentBinary("/some/path/agent/dist/main.js")).toBe(false);
		expect(isAgentBinary("agent.js")).toBe(false);
	});

	it("returns true for binary paths without .js extension", () => {
		expect(isAgentBinary("/usr/local/bin/nexterm-agent")).toBe(true);
		expect(isAgentBinary("/some/path/nexterm-agent.exe")).toBe(true);
		expect(isAgentBinary("nexterm-agent")).toBe(true);
	});
});

describe("resolveAgentPath", () => {
	it("returns a non-empty string", () => {
		const p = resolveAgentPath();
		expect(typeof p).toBe("string");
		expect(p.length).toBeGreaterThan(0);
	});

	it("returns the dev JS path when not in SEA mode", () => {
		// In the test environment we are never in SEA mode, so the dev fallback applies
		const p = resolveAgentPath();
		expect(p.endsWith(".js")).toBe(true);
		expect(p).toContain("agent");
	});
});

/** Collect the next N messages of the given type(s) from the agent. */
function collectMessages(
	agent: LocalAgent,
	types: string[],
	count: number,
	timeoutMs = 5_000,
): Promise<ProtocolMessage[]> {
	return new Promise((resolve, reject) => {
		const collected: ProtocolMessage[] = [];
		const timeout = setTimeout(() => {
			reject(
				new Error(`Timeout waiting for [${types.join(",")}]: got ${collected.length}/${count}`),
			);
		}, timeoutMs);

		const listener = (msg: ProtocolMessage) => {
			if (types.includes(msg.type)) {
				collected.push(msg);
				if (collected.length >= count) {
					clearTimeout(timeout);
					agent.off("message", listener);
					resolve(collected);
				}
			}
		};

		agent.on("message", listener);
	});
}

beforeAll(() => {
	if (!existsSync(AGENT_PATH)) {
		throw new Error(`Agent binary not found at ${AGENT_PATH}. Run \`pnpm build\` first.`);
	}
});

describe("LocalAgent", () => {
	let agent: LocalAgent;

	afterEach(() => {
		agent?.close();
	});

	it(
		"starts and receives HELLO",
		async () => {
			agent = new LocalAgent(AGENT_PATH);

			const helloPromise = new Promise<ProtocolMessage>((resolve) => {
				agent.once("ready", resolve);
			});

			await agent.start();
			const hello = await helloPromise;

			expect(hello.type).toBe("HELLO");
			if (hello.type === "HELLO") {
				expect(typeof hello.version).toBe("number");
				expect(Array.isArray(hello.capabilities)).toBe(true);
				expect(hello.capabilities).toContain("multiplex");
				expect(hello.capabilities).toContain("resize");
			}
			expect(agent.connected).toBe(true);
		},
		TEST_TIMEOUT,
	);

	it(
		"SPAWN creates a channel and returns SPAWN_OK",
		async () => {
			agent = new LocalAgent(AGENT_PATH);
			await agent.start();

			const requestId = "test-req-001";

			// Collect SPAWN_OK and CHANNEL_EXIT (/bin/echo exits immediately)
			const messagesPromise = collectMessages(agent, ["SPAWN_OK", "SPAWN_ERR", "CHANNEL_EXIT"], 2);

			agent.send({
				type: "SPAWN",
				requestId,
				shell: "/bin/echo",
				cwd: "/tmp",
				env: {},
				cols: 80,
				rows: 24,
			});

			const messages = await messagesPromise;

			const spawnOk = messages.find((m) => m.type === "SPAWN_OK");
			expect(spawnOk).toBeDefined();
			// Narrow to AgentSpawnOkMessage via requestId discriminant
			if (spawnOk?.type === "SPAWN_OK" && "requestId" in spawnOk) {
				expect(spawnOk.requestId).toBe(requestId);
				expect(typeof spawnOk.channelId).toBe("string");
				expect(spawnOk.channelId.length).toBeGreaterThan(0);
			}

			const channelExit = messages.find((m) => m.type === "CHANNEL_EXIT");
			expect(channelExit).toBeDefined();
		},
		TEST_TIMEOUT,
	);

	it(
		"HEARTBEAT returns HEARTBEAT_ACK with same ts",
		async () => {
			agent = new LocalAgent(AGENT_PATH);
			await agent.start();

			const ts = "2026-01-01T00:00:00.000Z";
			const ackPromise = collectMessages(agent, ["HEARTBEAT_ACK"], 1);

			agent.send({ type: "HEARTBEAT", ts });

			const [ack] = await ackPromise;
			expect(ack).toBeDefined();
			if (ack?.type === "HEARTBEAT_ACK") {
				expect(ack.ts).toBe(ts);
			} else {
				expect(ack?.type).toBe("HEARTBEAT_ACK");
			}
		},
		TEST_TIMEOUT,
	);

	it(
		"close() shuts down the agent and emits close event",
		async () => {
			agent = new LocalAgent(AGENT_PATH);
			await agent.start();

			const closePromise = new Promise<number | null>((resolve) => {
				agent.once("close", resolve);
			});

			expect(agent.connected).toBe(true);
			agent.close();

			const exitCode = await closePromise;
			expect(exitCode).toBeDefined(); // 0 or signal-based null
			expect(agent.connected).toBe(false);

			// Prevent afterEach double-close
			agent = null as unknown as LocalAgent;
		},
		TEST_TIMEOUT,
	);
});
