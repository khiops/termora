import { PROTOCOL_VERSION, encodeFrame } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHandler } from "./handler.js";
import type { PtyManager } from "./pty.js";

// ---------------------------------------------------------------------------
// Mock PtyManager factory
// ---------------------------------------------------------------------------

interface MockPtyManager {
	spawn: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	resize: ReturnType<typeof vi.fn>;
	nextSeq: ReturnType<typeof vi.fn>;
	onData: ReturnType<typeof vi.fn>;
	onExit: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	has: ReturnType<typeof vi.fn>;
	destroyAll: ReturnType<typeof vi.fn>;
	// Helpers for triggering registered callbacks in tests
	_triggerData: (channelId: string, raw: string) => void;
	_triggerExit: (channelId: string, exit: { exitCode: number; signal?: number }) => void;
}

function makeMockPtyManager(): MockPtyManager {
	const dataCallbacks = new Map<string, (data: string) => void>();
	const exitCallbacks = new Map<string, (exit: { exitCode: number; signal?: number }) => void>();

	return {
		spawn: vi.fn().mockReturnValue("chan-001"),
		write: vi.fn(),
		resize: vi.fn(),
		nextSeq: vi.fn().mockReturnValue(1),
		onData: vi.fn((channelId: string, cb: (data: string) => void) => {
			dataCallbacks.set(channelId, cb);
		}),
		onExit: vi.fn(
			(channelId: string, cb: (exit: { exitCode: number; signal?: number }) => void) => {
				exitCallbacks.set(channelId, cb);
			},
		),
		destroy: vi.fn(),
		has: vi.fn().mockReturnValue(true),
		destroyAll: vi.fn(),
		_triggerData: (channelId: string, raw: string) => {
			dataCallbacks.get(channelId)?.(raw);
		},
		_triggerExit: (channelId: string, exit: { exitCode: number; signal?: number }) => {
			exitCallbacks.get(channelId)?.(exit);
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHandler(mock: MockPtyManager): {
	handler: AgentHandler;
	sent: ProtocolMessage[];
} {
	const sent: ProtocolMessage[] = [];
	const handler = new AgentHandler((msg) => sent.push(msg), mock as unknown as PtyManager);
	return { handler, sent };
}

/** Wrap a ProtocolMessage in a frame and push it through onData. */
function pushMsg(handler: AgentHandler, msg: ProtocolMessage): void {
	handler.onData(Buffer.from(encodeFrame(msg)));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentHandler", () => {
	let mock: MockPtyManager;

	beforeEach(() => {
		mock = makeMockPtyManager();
	});

	// -------------------------------------------------------------------------
	// HELLO
	// -------------------------------------------------------------------------

	it("sendHello emits HELLO with correct version and capabilities", () => {
		const { handler, sent } = makeHandler(mock);
		handler.sendHello();

		expect(sent).toHaveLength(1);
		const msg = sent[0] as { type: string; version: number; capabilities: string[] };
		expect(msg.type).toBe("HELLO");
		expect(msg.version).toBe(PROTOCOL_VERSION);
		expect(msg.capabilities).toContain("multiplex");
		expect(msg.capabilities).toContain("resize");
	});

	// -------------------------------------------------------------------------
	// SPAWN
	// -------------------------------------------------------------------------

	it("SPAWN with valid shell returns SPAWN_OK with channelId", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-1",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		expect(mock.spawn).toHaveBeenCalledOnce();
		expect(sent).toHaveLength(1);
		const ok = sent[0] as { type: string; requestId: string; channelId: string };
		expect(ok.type).toBe("SPAWN_OK");
		expect(ok.requestId).toBe("req-1");
		expect(ok.channelId).toBe("chan-001");
	});

	it("SPAWN passes correct options to PtyManager", () => {
		const { handler } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-2",
			shell: "/bin/sh",
			cwd: "/home/user",
			env: { TERM: "xterm-256color" },
			cols: 120,
			rows: 40,
		});

		expect(mock.spawn).toHaveBeenCalledWith({
			shell: "/bin/sh",
			cwd: "/home/user",
			env: { TERM: "xterm-256color" },
			cols: 120,
			rows: 40,
		});
	});

	it("SPAWN failure returns SPAWN_ERR with error details", () => {
		mock.spawn.mockImplementationOnce(() => {
			throw new Error("ENOENT: /bin/nonexistent not found");
		});
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-3",
			shell: "/bin/nonexistent",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		expect(sent).toHaveLength(1);
		const err = sent[0] as { type: string; requestId: string; code: string };
		expect(err.type).toBe("SPAWN_ERR");
		expect(err.requestId).toBe("req-3");
		expect(err.code).toBe("SHELL_NOT_FOUND");
	});

	it("SPAWN permission error maps to PERMISSION_DENIED code", () => {
		mock.spawn.mockImplementationOnce(() => {
			throw new Error("EACCES: permission denied");
		});
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-4",
			shell: "/bin/restricted",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		const err = sent[0] as { type: string; code: string };
		expect(err.type).toBe("SPAWN_ERR");
		expect(err.code).toBe("PERMISSION_DENIED");
	});

	it("SPAWN unknown error maps to PTY_SPAWN_FAILED code", () => {
		mock.spawn.mockImplementationOnce(() => {
			throw new Error("something unexpected");
		});
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-5",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		const err = sent[0] as { type: string; code: string };
		expect(err.type).toBe("SPAWN_ERR");
		expect(err.code).toBe("PTY_SPAWN_FAILED");
	});

	// -------------------------------------------------------------------------
	// INPUT
	// -------------------------------------------------------------------------

	it("INPUT to existing channel writes to PtyManager", () => {
		const { handler } = makeHandler(mock);
		const data = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
		pushMsg(handler, { type: "INPUT", channelId: "chan-001", data });

		expect(mock.write).toHaveBeenCalledOnce();
		expect(mock.write).toHaveBeenCalledWith("chan-001", data);
	});

	it("INPUT to non-existent channel returns ERROR", () => {
		mock.has.mockReturnValue(false);
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "INPUT",
			channelId: "missing",
			data: new Uint8Array([0x61]),
		});

		expect(mock.write).not.toHaveBeenCalled();
		const err = sent[0] as { type: string; code: string; channelId: string };
		expect(err.type).toBe("ERROR");
		expect(err.code).toBe("CHANNEL_NOT_FOUND");
		expect(err.channelId).toBe("missing");
	});

	// -------------------------------------------------------------------------
	// RESIZE
	// -------------------------------------------------------------------------

	it("RESIZE calls PtyManager.resize with correct dimensions", () => {
		const { handler } = makeHandler(mock);
		pushMsg(handler, {
			type: "RESIZE",
			channelId: "chan-001",
			cols: 200,
			rows: 50,
		});

		expect(mock.resize).toHaveBeenCalledOnce();
		expect(mock.resize).toHaveBeenCalledWith("chan-001", 200, 50);
	});

	it("RESIZE to non-existent channel is silently ignored", () => {
		mock.has.mockReturnValue(false);
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "RESIZE",
			channelId: "gone",
			cols: 80,
			rows: 24,
		});

		expect(mock.resize).not.toHaveBeenCalled();
		expect(sent).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// DESTROY
	// -------------------------------------------------------------------------

	it("DESTROY calls PtyManager.destroy with the given channelId", () => {
		const { handler } = makeHandler(mock);
		pushMsg(handler, { type: "DESTROY", channelId: "chan-001" });

		expect(mock.destroy).toHaveBeenCalledOnce();
		expect(mock.destroy).toHaveBeenCalledWith("chan-001");
	});

	// -------------------------------------------------------------------------
	// HEARTBEAT
	// -------------------------------------------------------------------------

	it("HEARTBEAT returns HEARTBEAT_ACK echoing the same ts", () => {
		const { handler, sent } = makeHandler(mock);
		const ts = "2026-03-03T10:00:00.000Z";
		pushMsg(handler, { type: "HEARTBEAT", ts });

		expect(sent).toHaveLength(1);
		const ack = sent[0] as { type: string; ts: string };
		expect(ack.type).toBe("HEARTBEAT_ACK");
		expect(ack.ts).toBe(ts);
	});

	// -------------------------------------------------------------------------
	// Unknown message type
	// -------------------------------------------------------------------------

	it("unknown message type returns ERROR with INVALID_MESSAGE code", () => {
		const { handler, sent } = makeHandler(mock);
		// Use AUTH as a message type the agent does not handle directly
		pushMsg(handler, {
			type: "AUTH",
			token: "secret",
		});

		expect(sent).toHaveLength(1);
		const err = sent[0] as { type: string; code: string };
		expect(err.type).toBe("ERROR");
		expect(err.code).toBe("INVALID_MESSAGE");
	});

	// -------------------------------------------------------------------------
	// CHANNEL_EXIT (via PTY exit callback)
	// -------------------------------------------------------------------------

	it("PTY exit triggers CHANNEL_EXIT message", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-exit",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});
		// sent[0] is SPAWN_OK; now trigger the exit callback
		mock._triggerExit("chan-001", { exitCode: 0 });

		const exit = sent.find((m) => m.type === "CHANNEL_EXIT") as
			| { type: string; channelId: string; exitCode: number; signal?: string }
			| undefined;
		expect(exit).toBeDefined();
		expect(exit?.channelId).toBe("chan-001");
		expect(exit?.exitCode).toBe(0);
		expect(exit?.signal).toBeUndefined();
	});

	it("PTY exit with signal includes signal string", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-sig",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});
		mock._triggerExit("chan-001", { exitCode: 1, signal: 15 });

		const exit = sent.find((m) => m.type === "CHANNEL_EXIT") as { signal?: string } | undefined;
		expect(exit?.signal).toBe("SIG15");
	});

	// -------------------------------------------------------------------------
	// OUTPUT batching (via PTY data callback)
	// -------------------------------------------------------------------------

	it("PTY output triggers OUTPUT message after batching", () => {
		vi.useFakeTimers();
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-out",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		mock._triggerData("chan-001", "hello");
		// Not flushed yet
		expect(sent.filter((m) => m.type === "OUTPUT")).toHaveLength(0);

		// Advance past the batch window
		vi.advanceTimersByTime(20);

		const outputs = sent.filter((m) => m.type === "OUTPUT");
		expect(outputs).toHaveLength(1);
		const out = outputs[0] as { type: string; channelId: string; seq: number; data: Uint8Array };
		expect(out.channelId).toBe("chan-001");
		expect(out.seq).toBe(1);
		expect(Buffer.from(out.data).toString("binary")).toBe("hello");

		vi.useRealTimers();
	});

	it("OUTPUT flushes immediately when buffer exceeds 4KB", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-big",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		// Push slightly over 4096 bytes in one go
		const bigChunk = "x".repeat(4097);
		mock._triggerData("chan-001", bigChunk);

		const outputs = sent.filter((m) => m.type === "OUTPUT");
		expect(outputs).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// shutdown
	// -------------------------------------------------------------------------

	it("shutdown calls destroyAll on the PtyManager", () => {
		const { handler } = makeHandler(mock);
		handler.shutdown();
		expect(mock.destroyAll).toHaveBeenCalledOnce();
	});
});
