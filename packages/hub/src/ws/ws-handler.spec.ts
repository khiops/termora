import { decodeMessage, encodeMessage } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { describe, expect, it } from "vitest";

// ws-handler is thin dispatch glue — core logic lives in SessionManager (tested separately).
// These tests verify the MessagePack codec round-trips that ws-handler relies on.

describe("ws-handler codec round-trips", () => {
	it("SPAWN message (snake_case wire format) round-trips correctly", () => {
		const msg = {
			type: "SPAWN",
			hostId: "host-1",
			shell: "/bin/bash",
			cwd: "/home/user",
		} as unknown as ProtocolMessage;

		const encoded = encodeMessage(msg);
		expect(encoded).toBeInstanceOf(Uint8Array);

		const decoded = decodeMessage(encoded);
		expect(decoded.type).toBe("SPAWN");
		const spawnMsg = decoded as unknown as Record<string, string>;
		expect(spawnMsg.hostId).toBe("host-1");
		expect(spawnMsg.shell).toBe("/bin/bash");
		expect(spawnMsg.cwd).toBe("/home/user");
	});

	it("OUTPUT message with binary data round-trips", () => {
		const data = new Uint8Array([72, 101, 108, 108, 111]);
		const msg: ProtocolMessage = {
			type: "OUTPUT",
			channelId: "ch-1",
			seq: 42,
			ts: "2026-03-03T00:00:00Z",
			data,
		};

		const encoded = encodeMessage(msg);
		const decoded = decodeMessage(encoded);

		expect(decoded.type).toBe("OUTPUT");
		const outputMsg = decoded as unknown as Record<string, unknown>;
		expect(outputMsg.channelId).toBe("ch-1");
		expect(outputMsg.seq).toBe(42);
		expect(outputMsg.data).toBeInstanceOf(Uint8Array);
		expect(Array.from(outputMsg.data as Uint8Array)).toEqual([72, 101, 108, 108, 111]);
	});

	it("PING and PONG messages round-trip", () => {
		const ping: ProtocolMessage = { type: "PING" };
		const decodedPing = decodeMessage(encodeMessage(ping));
		expect(decodedPing.type).toBe("PING");

		const pong: ProtocolMessage = { type: "PONG" };
		const decodedPong = decodeMessage(encodeMessage(pong));
		expect(decodedPong.type).toBe("PONG");
	});

	it("ATTACH_OK with null snapshot round-trips", () => {
		const msg: ProtocolMessage = {
			type: "ATTACH_OK",
			channelId: "ch-1",
			snapshot: null,
			tail: [],
			writeLockHolder: null,
			cached: false,
		};

		const decoded = decodeMessage(encodeMessage(msg));
		expect(decoded.type).toBe("ATTACH_OK");
		const attachOk = decoded as unknown as Record<string, unknown>;
		expect(attachOk.channelId).toBe("ch-1");
		expect(attachOk.snapshot).toBeNull();
		expect(attachOk.tail).toEqual([]);
		expect(attachOk.writeLockHolder).toBeNull();
		expect(attachOk.cached).toBe(false);
	});

	it("ERROR message round-trips", () => {
		const msg: ProtocolMessage = {
			type: "ERROR",
			code: "CHANNEL_NOT_FOUND",
			message: "Channel xyz not found",
		};

		const decoded = decodeMessage(encodeMessage(msg));
		expect(decoded.type).toBe("ERROR");
		const errMsg = decoded as unknown as Record<string, string>;
		expect(errMsg.code).toBe("CHANNEL_NOT_FOUND");
		expect(errMsg.message).toBe("Channel xyz not found");
	});

	it("RESIZE message round-trips", () => {
		const msg: ProtocolMessage = {
			type: "RESIZE",
			channelId: "ch-2",
			cols: 120,
			rows: 40,
		};

		const decoded = decodeMessage(encodeMessage(msg));
		expect(decoded.type).toBe("RESIZE");
		const resizeMsg = decoded as unknown as Record<string, unknown>;
		expect(resizeMsg.channelId).toBe("ch-2");
		expect(resizeMsg.cols).toBe(120);
		expect(resizeMsg.rows).toBe(40);
	});
});
