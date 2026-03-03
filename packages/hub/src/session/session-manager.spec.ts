import type { ProtocolMessage } from "@nexterm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestDatabases } from "../storage/db.js";
import { SessionManager, type WsClient } from "./session-manager.js";

// Mock LocalAgent so tests never spawn real child processes.
// The mock auto-replies with SPAWN_OK for every SPAWN message.
vi.mock("./local-agent.js", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { EventEmitter } = require("node:events");

	class MockLocalAgent extends EventEmitter {
		private _connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn((msg: ProtocolMessage) => {
			if (msg.type === "SPAWN") {
				const spawnMsg = msg as unknown as Record<string, string>;
				setImmediate(() => {
					this.emit("message", {
						type: "SPAWN_OK",
						requestId: spawnMsg.requestId,
						channelId: "test-channel-id",
					});
				});
			}
		});
		close = vi.fn(() => {
			this._connected = false;
		});
		get connected() {
			return this._connected;
		}
	}

	return {
		LocalAgent: MockLocalAgent,
		resolveAgentPath: () => "/mock/agent/path",
	};
});

function makeClient(id: string, received: ProtocolMessage[]): WsClient {
	return {
		id,
		send: (msg) => received.push(msg),
		attachedChannels: new Set(),
	};
}

describe("SessionManager", () => {
	let sm: SessionManager;
	let dbManager: ReturnType<typeof openTestDatabases>;

	beforeEach(() => {
		dbManager = openTestDatabases();
		sm = new SessionManager(dbManager);
	});

	afterEach(async () => {
		await sm.shutdown();
		dbManager.close();
	});

	it("ensureLocalHost creates local host and is idempotent", async () => {
		const id1 = await sm.ensureLocalHost();
		expect(id1).toBeTruthy();
		expect(typeof id1).toBe("string");

		// Second call returns same id
		const id2 = await sm.ensureLocalHost();
		expect(id2).toBe(id1);
	});

	it("addClient and removeClient lifecycle (no error on unknown id)", () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);
		expect(() => sm.removeClient("non-existent")).not.toThrow();
		expect(() => sm.removeClient("c1")).not.toThrow();
	});

	it("handleSpawn sends SPAWN_OK to the requesting client", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);

		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		expect(received).toHaveLength(1);
		const first = received[0] as ProtocolMessage;
		expect(first.type).toBe("SPAWN_OK");

		const spawnOk = first as unknown as {
			type: string;
			channelId: string;
			hostId: string;
			sessionId: string;
		};
		expect(spawnOk.channelId).toBe("test-channel-id");
		expect(spawnOk.hostId).toBeTruthy();
		expect(spawnOk.sessionId).toBeTruthy();
	});

	it("handleSpawn auto-attaches the requesting client to the spawned channel", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);

		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		expect(client.attachedChannels.has("test-channel-id")).toBe(true);
	});

	it("handleAttach adds a second client to an existing channel", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);
		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		const client2Received: ProtocolMessage[] = [];
		const client2 = makeClient("c2", client2Received);
		sm.addClient(client2);
		sm.handleAttach("c2", "test-channel-id");

		expect(client2Received).toHaveLength(1);
		const firstAttach = client2Received[0] as ProtocolMessage;
		expect(firstAttach.type).toBe("ATTACH_OK");

		const attachOk = firstAttach as unknown as {
			type: string;
			channelId: string;
			snapshot: null;
			tail: unknown[];
			writeLockHolder: null;
			cached: boolean;
		};
		expect(attachOk.channelId).toBe("test-channel-id");
		expect(attachOk.snapshot).toBeNull();
		expect(attachOk.tail).toEqual([]);
		expect(attachOk.writeLockHolder).toBeNull();
		expect(attachOk.cached).toBe(false);
	});

	it("handleAttach sends ERROR for unknown channel", () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);

		sm.handleAttach("c1", "nonexistent-channel");

		expect(received).toHaveLength(1);
		const errMsg = received[0] as ProtocolMessage;
		expect(errMsg.type).toBe("ERROR");
		const err = errMsg as unknown as { type: string; code: string };
		expect(err.code).toBe("CHANNEL_NOT_FOUND");
	});

	it("handleDetach removes client from channel", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);
		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		expect(client.attachedChannels.has("test-channel-id")).toBe(true);

		sm.handleDetach("c1", "test-channel-id");

		expect(client.attachedChannels.has("test-channel-id")).toBe(false);
	});

	it("handleInput forwards to agent without throwing", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);
		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		expect(() => {
			sm.handleInput("c1", "test-channel-id", new Uint8Array([65, 66, 67]));
		}).not.toThrow();
	});

	it("handleResize forwards to agent without throwing", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);
		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		expect(() => {
			sm.handleResize("c1", "test-channel-id", 120, 40);
		}).not.toThrow();
	});

	it("removeClient cleans up all channel attachments", async () => {
		const received: ProtocolMessage[] = [];
		const client = makeClient("c1", received);
		sm.addClient(client);
		await sm.handleSpawn("c1", { type: "SPAWN", hostId: "local" });

		expect(client.attachedChannels.size).toBe(1);

		sm.removeClient("c1");

		expect(client.attachedChannels.size).toBe(0);
	});
});
