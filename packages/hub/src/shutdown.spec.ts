import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMessage, encodeMessage, type ProtocolMessage } from "@termora/shared";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, startServer } from "./server.js";
import { gracefulShutdown, resetGracefulShutdownForTests } from "./shutdown.js";
import type { DatabaseManager } from "./storage/db.js";
import { openTestDatabases } from "./storage/db.js";

const TEST_TOKEN = "a".repeat(64);
const OWNER_TOKEN = "b".repeat(64);

describe("gracefulShutdown", () => {
	afterEach(() => {
		resetGracefulShutdownForTests();
	});

	it("is idempotent and tears down server, DB, runtime, then exits", async () => {
		const server = Fastify({ logger: false });
		const dbs = openTestDatabases();
		const order: string[] = [];
		const exits: number[] = [];

		server.addHook("onClose", async () => {
			order.push("server.close");
		});
		await server.ready();

		const close = dbs.close.bind(dbs);
		const closeSpy = vi.spyOn(dbs, "close").mockImplementation(() => {
			order.push("db.close");
			close();
		});

		const options = {
			server,
			dbManager: dbs,
			deleteRuntime: () => order.push("runtime.delete"),
			exit: (code: number) => {
				order.push(`exit:${code}`);
				exits.push(code);
			},
			timeoutMs: 1_000,
		};

		const first = gracefulShutdown(options);
		const second = gracefulShutdown(options);

		expect(second).toBe(first);
		await first;

		expect(order).toEqual(["server.close", "db.close", "runtime.delete", "exit:0"]);
		expect(exits).toEqual([0]);
		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it("deletes runtime and exits nonzero when server.close hangs", async () => {
		const server = Fastify({ logger: false });
		const dbs = openTestDatabases();
		const dir = mkdtempSync(join(tmpdir(), "termora-shutdown-"));
		const runtimePath = join(dir, "runtime.json");
		const exits: number[] = [];

		writeFileSync(runtimePath, "{}");
		server.addHook("onClose", () => new Promise<void>(() => {}));
		await server.ready();

		await gracefulShutdown({
			server,
			dbManager: dbs,
			deleteRuntime: () => rmSync(runtimePath, { force: true }),
			exit: (code) => {
				exits.push(code);
			},
			timeoutMs: 10,
		});

		expect(exits).toEqual([1]);
		expect(existsSync(runtimePath)).toBe(false);

		dbs.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("POST /api/shutdown", () => {
	let server: FastifyInstance | undefined;
	let dbs: DatabaseManager | undefined;

	afterEach(async () => {
		if (server) {
			try {
				await server.close();
			} catch {
				// already closed by the test path
			}
			server = undefined;
		}
		dbs?.close();
		dbs = undefined;
	});

	it("requires owner token and loopback; paired Bearer auth is not enough", async () => {
		let shutdownCalls = 0;
		server = await createServer({
			logger: false,
			ownerToken: OWNER_TOKEN,
			onShutdown: () => {
				shutdownCalls++;
			},
		});

		const missing = await server.inject({ method: "POST", url: "/api/shutdown" });
		expect(missing.statusCode).toBe(401);

		const pairedBearerOnly = await server.inject({
			method: "POST",
			url: "/api/shutdown",
			headers: { authorization: `Bearer ${TEST_TOKEN}` },
		});
		expect(pairedBearerOnly.statusCode).toBe(401);

		const remote = await server.inject({
			method: "POST",
			url: "/api/shutdown",
			headers: { "x-termora-owner": OWNER_TOKEN },
			remoteAddress: "203.0.113.10",
		});
		expect(remote.statusCode).toBe(403);

		const ok = await server.inject({
			method: "POST",
			url: "/api/shutdown",
			headers: { "x-termora-owner": OWNER_TOKEN },
		});
		expect(ok.statusCode).toBe(200);
		await tick();
		expect(shutdownCalls).toBe(1);
	});

	it("does not run shutdown when no owner token is configured", async () => {
		let shutdownCalls = 0;
		server = await createServer({
			logger: false,
			onShutdown: () => {
				shutdownCalls++;
			},
		});

		const response = await server.inject({
			method: "POST",
			url: "/api/shutdown",
			headers: { "x-termora-owner": OWNER_TOKEN },
		});

		expect(response.statusCode).toBe(401);
		await tick();
		expect(shutdownCalls).toBe(0);
	});

	it("rejects a valid paired bearer on shutdown when the owner token is missing", async () => {
		dbs = openTestDatabases();
		let shutdownCalls = 0;
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			ownerToken: OWNER_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
			onShutdown: () => {
				shutdownCalls++;
			},
		});

		const pairedBearerOnly = await server.inject({
			method: "POST",
			url: "/api/shutdown",
			headers: { authorization: `Bearer ${TEST_TOKEN}` },
		});

		expect(pairedBearerOnly.statusCode).toBe(401);
		await tick();
		expect(shutdownCalls).toBe(0);
	});

	it("does not exempt non-POST /api/shutdown from bearer auth", async () => {
		dbs = openTestDatabases();
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			ownerToken: OWNER_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});

		const missingBearer = await server.inject({ method: "GET", url: "/api/shutdown" });
		expect(missingBearer.statusCode).toBe(401);

		const withBearer = await server.inject({
			method: "GET",
			url: "/api/shutdown",
			headers: { authorization: `Bearer ${TEST_TOKEN}` },
		});
		expect(withBearer.statusCode).toBe(404);
	});

	it("guards other connected clients and allows force=1", async () => {
		dbs = openTestDatabases();
		let shutdownCalls = 0;
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			ownerToken: OWNER_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
			onShutdown: () => {
				shutdownCalls++;
			},
		});
		const address = await startServer(server, { port: 0 });
		const first = await connectAuthedWebSocket(address, TEST_TOKEN);
		const second = await connectAuthedWebSocket(address, TEST_TOKEN);

		const guarded = await fetch(`${address}/api/shutdown`, {
			method: "POST",
			headers: {
				"X-Termora-Owner": OWNER_TOKEN,
				"X-Termora-Client-Id": first.clientId,
			},
		});

		expect(guarded.status).toBe(409);
		expect(await guarded.json()).toEqual({ others: 1 });
		expect(shutdownCalls).toBe(0);

		const forced = await fetch(`${address}/api/shutdown?force=1`, {
			method: "POST",
			headers: {
				"X-Termora-Owner": OWNER_TOKEN,
				"X-Termora-Client-Id": first.clientId,
			},
		});

		expect(forced.status).toBe(200);
		await tick();
		expect(shutdownCalls).toBe(1);

		await Promise.all([first.close(), second.close()]);
	});
});

async function connectAuthedWebSocket(
	address: string,
	token: string,
): Promise<{ clientId: string; close: () => Promise<void> }> {
	const ws = new WebSocket(`${address.replace(/^http/, "ws")}/ws`);
	ws.binaryType = "arraybuffer";
	await once(ws, "open");

	const authOk = new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("AUTH_OK timeout")), 2_000);
		ws.addEventListener("message", (event) => {
			try {
				const msg = decodeWsMessage(event.data);
				if (msg.type === "AUTH_OK") {
					clearTimeout(timer);
					resolve(msg.clientId);
				} else if (msg.type === "AUTH_FAIL") {
					clearTimeout(timer);
					reject(new Error(msg.message));
				}
			} catch (err) {
				clearTimeout(timer);
				reject(err);
			}
		});
	});

	ws.send(encodeMessage({ type: "AUTH", token }));
	const clientId = await authOk;

	return {
		clientId,
		close: () => closeWebSocket(ws),
	};
}

function decodeWsMessage(data: unknown): ProtocolMessage {
	if (data instanceof ArrayBuffer) {
		return decodeMessage(new Uint8Array(data));
	}
	if (ArrayBuffer.isView(data)) {
		return decodeMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}
	throw new Error(`Unexpected WebSocket message payload: ${typeof data}`);
}

function once(ws: WebSocket, eventName: "open" | "close"): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${eventName} timeout`)), 2_000);
		ws.addEventListener(
			eventName,
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
		ws.addEventListener(
			"error",
			() => {
				clearTimeout(timer);
				reject(new Error(`WebSocket ${eventName} failed`));
			},
			{ once: true },
		);
	});
}

async function closeWebSocket(ws: WebSocket): Promise<void> {
	if (ws.readyState === WebSocket.CLOSED) return;
	const closed = once(ws, "close");
	ws.close();
	await closed;
}

function tick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
