import { decodeMessage, encodeMessage } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { isValidDimensions, isValidEnv, isValidInputData, isValidUlid } from "@nexterm/shared";
import { describe, expect, it } from "vitest";

/** Known token used across auth tests */
const TEST_TOKEN = "a".repeat(64);

// ws-handler is thin dispatch glue — core logic lives in SessionManager (tested separately).
// These tests verify the MessagePack codec round-trips that ws-handler relies on,
// plus the AUTH message protocol types.

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

describe("ws-handler AUTH protocol codec", () => {
	it("AUTH message encodes and decodes correctly", () => {
		const msg: ProtocolMessage = {
			type: "AUTH",
			token: TEST_TOKEN,
		};

		const decoded = decodeMessage(encodeMessage(msg));
		expect(decoded.type).toBe("AUTH");
		const authMsg = decoded as unknown as Record<string, string>;
		expect(authMsg.token).toBe(TEST_TOKEN);
	});

	it("AUTH_OK message encodes and decodes correctly", () => {
		const msg: ProtocolMessage = {
			type: "AUTH_OK",
			clientId: "01ABCDEF",
		};

		const decoded = decodeMessage(encodeMessage(msg));
		expect(decoded.type).toBe("AUTH_OK");
		// clientId is camelCase in TS; wire may be snake_case depending on codec
		const authOk = decoded as unknown as Record<string, string>;
		expect(authOk.clientId ?? authOk.client_id).toBe("01ABCDEF");
	});

	it("AUTH_FAIL message encodes and decodes correctly", () => {
		const msg: ProtocolMessage = {
			type: "AUTH_FAIL",
			message: "Invalid token",
		};

		const decoded = decodeMessage(encodeMessage(msg));
		expect(decoded.type).toBe("AUTH_FAIL");
		const failMsg = decoded as unknown as Record<string, string>;
		expect(failMsg.message).toBe("Invalid token");
	});
});

// Input validation tests — verify the validators that ws-handler applies before dispatch.
// The validators themselves are tested exhaustively in packages/shared/src/validation.spec.ts.
// These tests confirm the validation rules match ws-handler's usage patterns.
describe("ws-handler input validation", () => {
	const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

	describe("channelId validation (ATTACH, DETACH, INPUT, RESIZE, WRITE_*)", () => {
		it("rejects non-ULID channelId", () => {
			expect(isValidUlid("not-a-ulid")).toBe(false);
			expect(isValidUlid("")).toBe(false);
			expect(isValidUlid(123)).toBe(false);
		});

		it("accepts valid ULID channelId", () => {
			expect(isValidUlid(VALID_ULID)).toBe(true);
		});
	});

	describe("SPAWN hostId validation", () => {
		it("rejects non-ULID hostId", () => {
			expect(isValidUlid("bad-host-id")).toBe(false);
		});

		it("accepts valid ULID hostId", () => {
			expect(isValidUlid(VALID_ULID)).toBe(true);
		});
	});

	describe("INPUT data validation", () => {
		it("rejects oversized input data", () => {
			const oversized = new Uint8Array(65_537);
			expect(isValidInputData(oversized)).toBe(false);
		});

		it("accepts normal-sized input data", () => {
			const normal = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
			expect(isValidInputData(normal)).toBe(true);
		});

		it("rejects non-Uint8Array data", () => {
			expect(isValidInputData("hello")).toBe(false);
		});
	});

	describe("RESIZE dimensions validation", () => {
		it("rejects zero dimensions", () => {
			expect(isValidDimensions(0, 24)).toBe(false);
			expect(isValidDimensions(80, 0)).toBe(false);
		});

		it("rejects dimensions above 500", () => {
			expect(isValidDimensions(501, 24)).toBe(false);
			expect(isValidDimensions(80, 501)).toBe(false);
		});

		it("rejects non-integer dimensions", () => {
			expect(isValidDimensions(80.5, 24)).toBe(false);
		});

		it("accepts valid dimensions", () => {
			expect(isValidDimensions(80, 24)).toBe(true);
			expect(isValidDimensions(1, 1)).toBe(true);
			expect(isValidDimensions(500, 500)).toBe(true);
		});
	});

	describe("SPAWN env validation", () => {
		it("rejects env with non-string values", () => {
			expect(isValidEnv({ KEY: 123 })).toBe(false);
		});

		it("rejects env with too many entries", () => {
			const bigEnv: Record<string, string> = {};
			for (let i = 0; i <= 256; i++) {
				bigEnv[`K${i}`] = "v";
			}
			expect(isValidEnv(bigEnv)).toBe(false);
		});

		it("accepts valid env", () => {
			expect(isValidEnv({ PATH: "/usr/bin" })).toBe(true);
		});

		it("accepts undefined env (optional)", () => {
			expect(isValidEnv(undefined)).toBe(true);
		});
	});

	describe("INVALID_INPUT error message format", () => {
		it("INVALID_INPUT error round-trips through codec", () => {
			const msg: ProtocolMessage = {
				type: "ERROR",
				code: "INVALID_INPUT",
				message: "Invalid channelId",
			};

			const decoded = decodeMessage(encodeMessage(msg));
			expect(decoded.type).toBe("ERROR");
			const errMsg = decoded as unknown as Record<string, string>;
			expect(errMsg.code).toBe("INVALID_INPUT");
			expect(errMsg.message).toBe("Invalid channelId");
		});
	});
});
