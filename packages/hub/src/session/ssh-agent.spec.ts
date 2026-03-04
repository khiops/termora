import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import type { HelloMessage } from "@nexterm/shared";
import type { Host } from "@nexterm/shared";
import { Server, type Server as SshServer } from "ssh2";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { SshAgent } from "./ssh-agent.js";

const TEST_TIMEOUT = 10_000;

// Generate a host key once for all tests in this module.
const { privateKey: HOST_KEY } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "pkcs1", format: "pem" },
	privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

// Generate a client key in PKCS#1 PEM format (required by ssh2).
// Write to a temp file so SshAgent.start() can read it via sshKeyPath.
const { privateKey: CLIENT_PRIVATE_KEY_PEM } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "pkcs1", format: "pem" },
	privateKeyEncoding: { type: "pkcs1", format: "pem" },
});
const KEY_TMPDIR = mkdtempSync(join(tmpdir(), "nexterm-ssh-agent-test-"));
const CLIENT_KEY_PATH = join(KEY_TMPDIR, "client.pem");
writeFileSync(CLIENT_KEY_PATH, CLIENT_PRIVATE_KEY_PEM, { mode: 0o600 });

/** Minimal HELLO payload used by the mock agent. */
const HELLO_MSG: HelloMessage = {
	type: "HELLO",
	version: 1,
	agentVersion: "0.0.0-test",
	capabilities: ["multiplex", "snapshot", "resize"],
};

/** Encode HELLO as a framed MessagePack buffer. */
function makeHelloFrame(): Buffer {
	return Buffer.from(encodeFrame(HELLO_MSG));
}

/**
 * Create a mock SSH server that accepts all authentication and dispatches
 * exec sessions to `onExec`.
 *
 * Returns the server and the port it is listening on.
 */
function createMockSshServer(
	onExec: (stream: NodeJS.ReadWriteStream) => void,
	opts: { rejectAuth?: boolean } = {},
): Promise<{ server: SshServer; port: number }> {
	return new Promise((resolve) => {
		const server = new Server({ hostKeys: [HOST_KEY] }, (client) => {
			client.on("authentication", (ctx) => {
				if (opts.rejectAuth) {
					ctx.reject(["publickey"]);
					return;
				}
				ctx.accept();
			});

			client.on("ready", () => {
				client.on("session", (accept) => {
					const session = accept();
					session.on("exec", (accept) => {
						const stream = accept();
						onExec(stream);
					});
				});
			});
		});

		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as { port: number };
			resolve({ server, port: addr.port });
		});
	});
}

/** Build a minimal Host object for a mock SSH server on localhost. */
function makeHost(port: number, overrides: Partial<Host> = {}): Host {
	return {
		id: "01HZ000000000000000000001",
		type: "ssh",
		label: "test-host",
		sshHost: "127.0.0.1",
		sshPort: port,
		sshAuth: "key",
		sshKeyPath: CLIENT_KEY_PATH,
		iconType: "auto",
		trustRemoteHints: "ignore",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

afterAll(() => {
	// Remove the temp directory holding the generated client key.
	rmSync(KEY_TMPDIR, { recursive: true, force: true });
});

describe("SshAgent", () => {
	// Track agents created per test so they are cleaned up in afterEach.
	let agents: SshAgent[] = [];
	let servers: SshServer[] = [];

	afterEach(async () => {
		for (const agent of agents) {
			try {
				agent.close();
			} catch {
				// already closed
			}
		}
		agents = [];

		await Promise.all(
			servers.map(
				(srv) =>
					new Promise<void>((resolve) => {
						srv.close(() => resolve());
					}),
			),
		);
		servers = [];
	});

	it(
		"connects to mock SSH server and receives HELLO",
		async () => {
			const { server, port } = await createMockSshServer((stream) => {
				// Mock agent: immediately send HELLO frame, then stay open.
				stream.write(makeHelloFrame());
			});
			servers.push(server);

			const agent = new SshAgent(makeHost(port));
			agents.push(agent);

			const hello = await agent.start();

			expect(hello.type).toBe("HELLO");
			expect(hello.version).toBe(1);
			expect(hello.capabilities).toContain("multiplex");
			expect(agent.connected).toBe(true);
		},
		TEST_TIMEOUT,
	);

	it(
		"SPAWN → SPAWN_OK flows correctly through SSH",
		async () => {
			const { server, port } = await createMockSshServer((stream) => {
				// Mock agent: send HELLO, then listen for SPAWN and reply with SPAWN_OK.
				stream.write(makeHelloFrame());

				const chunks: Buffer[] = [];
				stream.on("data", (data: Buffer) => {
					chunks.push(data);
					// A real agent would parse frames — for simplicity we send SPAWN_OK
					// after receiving any data, which mimics the SPAWN message arriving.
					const spawnOkMsg: ProtocolMessage = {
						type: "SPAWN_OK",
						requestId: "req-001",
						channelId: "chan-01HZ000000000000000000001",
					};
					stream.write(Buffer.from(encodeFrame(spawnOkMsg)));
					// remove listener to avoid duplicate replies
					stream.removeAllListeners("data");
				});
			});
			servers.push(server);

			const agent = new SshAgent(makeHost(port));
			agents.push(agent);

			await agent.start();

			const spawnOkPromise = new Promise<ProtocolMessage>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("Timeout waiting for SPAWN_OK")), 5_000);
				agent.on("message", (msg: ProtocolMessage) => {
					if (msg.type === "SPAWN_OK") {
						clearTimeout(timeout);
						resolve(msg);
					}
				});
			});

			agent.send({
				type: "SPAWN",
				requestId: "req-001",
				shell: "/bin/sh",
				cwd: "/tmp",
				env: {},
				cols: 80,
				rows: 24,
			});

			const spawnOk = await spawnOkPromise;
			expect(spawnOk.type).toBe("SPAWN_OK");
			if (spawnOk.type === "SPAWN_OK" && "requestId" in spawnOk) {
				expect(spawnOk.requestId).toBe("req-001");
				expect(typeof spawnOk.channelId).toBe("string");
			}
		},
		TEST_TIMEOUT,
	);

	it(
		"emits error on SSH connection failure (wrong port)",
		async () => {
			// Port 1 is reserved and should refuse connections quickly.
			const agent = new SshAgent(makeHost(1));
			agents.push(agent);

			await expect(agent.start()).rejects.toThrow();
		},
		TEST_TIMEOUT,
	);

	it(
		"emits error on SSH auth failure",
		async () => {
			const { server, port } = await createMockSshServer(
				() => {
					// never called — auth is rejected
				},
				{ rejectAuth: true },
			);
			servers.push(server);

			const agent = new SshAgent(makeHost(port));
			agents.push(agent);

			await expect(agent.start()).rejects.toThrow();
		},
		TEST_TIMEOUT,
	);

	it("rejects with HELLO timeout when agent never sends HELLO", async () => {
		const { server, port } = await createMockSshServer((stream) => {
			// Mock agent: connect but never send HELLO.
			// Keep the stream open so the timeout triggers.
			stream.on("data", () => {
				// ignore incoming data
			});
		});
		servers.push(server);

		const agent = new SshAgent(makeHost(port));
		agents.push(agent);

		// SshAgent uses 5 s HELLO timeout — give 6 s for the test.
		await expect(agent.start()).rejects.toThrow("Agent HELLO timeout");
	}, 6_000);

	it(
		"close() terminates the SSH channel and connection",
		async () => {
			const { server, port } = await createMockSshServer((stream) => {
				stream.write(makeHelloFrame());
			});
			servers.push(server);

			const agent = new SshAgent(makeHost(port));
			agents.push(agent);

			await agent.start();
			expect(agent.connected).toBe(true);

			const closePromise = new Promise<void>((resolve) => {
				agent.once("close", () => resolve());
			});

			agent.close();

			// After close(), connected must flip immediately
			expect(agent.connected).toBe(false);

			// Wait for the close event to propagate (SSH connection ends)
			await closePromise;

			// Prevent afterEach double-close
			agents = agents.filter((a) => a !== agent);
		},
		TEST_TIMEOUT,
	);
});
