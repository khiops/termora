import { PROTOCOL_VERSION, encodeFrame } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock shell-detection so handler.spec.ts never touches the real fs.
// ---------------------------------------------------------------------------

vi.mock("./shell-detection.js", () => ({
	detectAvailableShells: vi.fn().mockResolvedValue(["/bin/bash", "/bin/sh"]),
	getDefaultShell: vi.fn().mockReturnValue("/bin/bash"),
	_resetShellCache: vi.fn(),
}));

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
	lastSeq: ReturnType<typeof vi.fn>;
	snapshot: ReturnType<typeof vi.fn>;
	onData: ReturnType<typeof vi.fn>;
	onExit: ReturnType<typeof vi.fn>;
	onTitleChange: ReturnType<typeof vi.fn>;
	onBell: ReturnType<typeof vi.fn>;
	onOsc9: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	has: ReturnType<typeof vi.fn>;
	getPid: ReturnType<typeof vi.fn>;
	destroyAll: ReturnType<typeof vi.fn>;
	// Helpers for triggering registered callbacks in tests
	_triggerData: (channelId: string, raw: string) => void;
	_triggerExit: (channelId: string, exit: { exitCode: number; signal?: number }) => void;
	_triggerTitleChange: (channelId: string, title: string) => void;
	_triggerBell: (channelId: string) => void;
	_triggerOsc9: (channelId: string, message: string) => void;
}

function makeMockPtyManager(): MockPtyManager {
	const dataCallbacks = new Map<string, (data: string) => void>();
	const exitCallbacks = new Map<string, (exit: { exitCode: number; signal?: number }) => void>();
	const titleCallbacks = new Map<string, (title: string) => void>();
	const bellCallbacks = new Map<string, () => void>();
	const osc9Callbacks = new Map<string, (message: string) => boolean>();

	const defaultSnapshot = {
		serialized: "\x1b[1;1Hhello world",
		cols: 80,
		rows: 24,
		cursorX: 11,
		cursorY: 0,
	};

	return {
		spawn: vi.fn().mockReturnValue("chan-001"),
		write: vi.fn(),
		resize: vi.fn(),
		nextSeq: vi.fn().mockReturnValue(1),
		lastSeq: vi.fn().mockReturnValue(5),
		snapshot: vi.fn().mockReturnValue(defaultSnapshot),
		onData: vi.fn((channelId: string, cb: (data: string) => void) => {
			dataCallbacks.set(channelId, cb);
		}),
		onExit: vi.fn(
			(channelId: string, cb: (exit: { exitCode: number; signal?: number }) => void) => {
				exitCallbacks.set(channelId, cb);
			},
		),
		onTitleChange: vi.fn((channelId: string, cb: (title: string) => void) => {
			titleCallbacks.set(channelId, cb);
		}),
		onBell: vi.fn((channelId: string, cb: () => void) => {
			bellCallbacks.set(channelId, cb);
		}),
		onOsc9: vi.fn((channelId: string, cb: (message: string) => boolean) => {
			osc9Callbacks.set(channelId, cb);
		}),
		destroy: vi.fn(),
		has: vi.fn().mockReturnValue(true),
		getPid: vi.fn().mockReturnValue(null), // null = skip polling (no real process in tests)
		destroyAll: vi.fn(),
		_triggerData: (channelId: string, raw: string) => {
			dataCallbacks.get(channelId)?.(raw);
		},
		_triggerExit: (channelId: string, exit: { exitCode: number; signal?: number }) => {
			exitCallbacks.get(channelId)?.(exit);
		},
		_triggerTitleChange: (channelId: string, title: string) => {
			titleCallbacks.get(channelId)?.(title);
		},
		_triggerBell: (channelId: string) => {
			bellCallbacks.get(channelId)?.();
		},
		_triggerOsc9: (channelId: string, message: string) => {
			osc9Callbacks.get(channelId)?.(message);
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

	it("sendHello emits HELLO with correct version and capabilities", async () => {
		const { handler, sent } = makeHandler(mock);
		await handler.sendHello();

		expect(sent).toHaveLength(1);
		const msg = sent[0] as { type: string; version: number; capabilities: string[] };
		expect(msg.type).toBe("HELLO");
		expect(msg.version).toBe(PROTOCOL_VERSION);
		expect(msg.capabilities).toContain("multiplex");
		expect(msg.capabilities).toContain("resize");
		expect(msg.capabilities).toContain("snapshot");
	});

	// SC-23: HELLO includes shells and launch-profiles capability
	it("SC-23: sendHello includes available_shells, default_shell, and launch-profiles capability", async () => {
		const { handler, sent } = makeHandler(mock);
		await handler.sendHello();

		expect(sent).toHaveLength(1);
		const msg = sent[0] as {
			type: string;
			capabilities: string[];
			availableShells?: string[];
			defaultShell?: string;
		};
		expect(msg.type).toBe("HELLO");
		// Capabilities must include the new entry
		expect(msg.capabilities).toContain("launch-profiles");
		// Shell discovery results must be present (mocked values)
		expect(msg.availableShells).toEqual(["/bin/bash", "/bin/sh"]);
		expect(msg.defaultShell).toBe("/bin/bash");
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
			id: undefined,
			shell: "/bin/sh",
			cwd: "/home/user",
			env: { TERM: "xterm-256color" },
			cols: 120,
			rows: 40,
			envMode: 'inherit',
		});
	});

	it("SPAWN with channelId uses provided id for channel and SPAWN_OK", () => {
		// Override spawn mock to return whatever id was passed in options
		mock.spawn.mockImplementationOnce((opts: { id?: string }) => opts.id ?? "chan-fallback");
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-cid",
			channelId: "custom-channel-123",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		expect(mock.spawn).toHaveBeenCalledWith(expect.objectContaining({ id: "custom-channel-123" }));
		const ok = sent[0] as { type: string; requestId: string; channelId: string };
		expect(ok.type).toBe("SPAWN_OK");
		expect(ok.channelId).toBe("custom-channel-123");
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
		expect(exit?.signal).toBe("SIGTERM");
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

	// -------------------------------------------------------------------------
	// SNAPSHOT_REQ → SNAPSHOT_RES
	// -------------------------------------------------------------------------

	it("SNAPSHOT_REQ returns SNAPSHOT_RES with valid snapshot data", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, { type: "SNAPSHOT_REQ", channelId: "chan-001" });

		expect(mock.snapshot).toHaveBeenCalledWith("chan-001");
		expect(sent).toHaveLength(1);
		const res = sent[0] as {
			type: string;
			channelId: string;
			snapshot: {
				serialized: string;
				cols: number;
				rows: number;
				cursorX: number;
				cursorY: number;
			};
			lastSeq: number;
		};
		expect(res.type).toBe("SNAPSHOT_RES");
		expect(res.channelId).toBe("chan-001");
		expect(res.snapshot.cols).toBe(80);
		expect(res.snapshot.rows).toBe(24);
		expect(res.snapshot.serialized).toBeTruthy();
		expect(res.lastSeq).toBe(5);
	});

	it("SNAPSHOT_REQ for unknown channel is silently ignored", () => {
		mock.snapshot.mockReturnValueOnce(null);
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, { type: "SNAPSHOT_REQ", channelId: "gone-channel" });

		// No response emitted — hub reconciles on its own
		expect(sent).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// ATTACH → ATTACH_OK
	// -------------------------------------------------------------------------

	it("ATTACH returns ATTACH_OK with snapshot when channel exists", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, { type: "ATTACH", channelId: "chan-001" });

		expect(mock.snapshot).toHaveBeenCalledWith("chan-001");
		expect(sent).toHaveLength(1);
		const ok = sent[0] as {
			type: string;
			channelId: string;
			snapshot: { serialized: string; cols: number; rows: number };
			lastSeq: number;
		};
		expect(ok.type).toBe("ATTACH_OK");
		expect(ok.channelId).toBe("chan-001");
		expect(ok.snapshot).toBeDefined();
		expect(ok.lastSeq).toBe(5);
	});

	it("ATTACH for unknown channel returns ERROR with CHANNEL_NOT_FOUND", () => {
		mock.snapshot.mockReturnValueOnce(null);
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, { type: "ATTACH", channelId: "missing-chan" });

		expect(sent).toHaveLength(1);
		const err = sent[0] as { type: string; code: string; channelId: string };
		expect(err.type).toBe("ERROR");
		expect(err.code).toBe("CHANNEL_NOT_FOUND");
		expect(err.channelId).toBe("missing-chan");
	});

	// -------------------------------------------------------------------------
	// TITLE_CHANGE (via headless terminal onTitleChange)
	// -------------------------------------------------------------------------

	it("title change emits TITLE_CHANGE after debounce", () => {
		vi.useFakeTimers();
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-title",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		mock._triggerTitleChange("chan-001", "vim file.ts");

		// Not sent yet — debounced
		expect(sent.filter((m) => m.type === "TITLE_CHANGE")).toHaveLength(0);

		vi.advanceTimersByTime(100);

		const titleMsgs = sent.filter((m) => m.type === "TITLE_CHANGE");
		expect(titleMsgs).toHaveLength(1);
		const msg = titleMsgs[0] as { type: string; channelId: string; title: string };
		expect(msg.channelId).toBe("chan-001");
		expect(msg.title).toBe("vim file.ts");

		vi.useRealTimers();
	});

	it("rapid title changes are debounced (last-write-wins)", () => {
		vi.useFakeTimers();
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-debounce",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		mock._triggerTitleChange("chan-001", "first");
		vi.advanceTimersByTime(50);
		mock._triggerTitleChange("chan-001", "second");
		vi.advanceTimersByTime(50);
		mock._triggerTitleChange("chan-001", "third");
		vi.advanceTimersByTime(100);

		const titleMsgs = sent.filter((m) => m.type === "TITLE_CHANGE");
		expect(titleMsgs).toHaveLength(1);
		const msg = titleMsgs[0] as { type: string; title: string };
		expect(msg.title).toBe("third");

		vi.useRealTimers();
	});

	it("empty title after sanitization is not sent", () => {
		vi.useFakeTimers();
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-empty",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		// Only control chars — sanitizes to empty
		mock._triggerTitleChange("chan-001", "\x07\x1b");
		vi.advanceTimersByTime(100);

		expect(sent.filter((m) => m.type === "TITLE_CHANGE")).toHaveLength(0);

		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// BELL (via headless terminal onBell)
	// -------------------------------------------------------------------------

	it("bell detection sends BELL message", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-bell",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		mock._triggerBell("chan-001");

		const bellMsgs = sent.filter((m) => m.type === "BELL");
		expect(bellMsgs).toHaveLength(1);
		const msg = bellMsgs[0] as { type: string; channelId: string };
		expect(msg.channelId).toBe("chan-001");
	});

	it("rapid bells are throttled to 1 per 100ms", () => {
		vi.useFakeTimers();
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-bell-throttle",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		// Fire 5 bells rapidly at t=0
		for (let i = 0; i < 5; i++) {
			mock._triggerBell("chan-001");
		}

		// Only 1 should have been sent (first one at t=0, rest throttled)
		expect(sent.filter((m) => m.type === "BELL")).toHaveLength(1);

		// Advance past throttle window
		vi.advanceTimersByTime(100);

		// Now another bell should be allowed
		mock._triggerBell("chan-001");
		expect(sent.filter((m) => m.type === "BELL")).toHaveLength(2);

		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// OSC 9 NOTIFICATION (via headless terminal registerOsc9Handler)
	// -------------------------------------------------------------------------

	it("OSC 9 sends NOTIFICATION with message text", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-osc9",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		mock._triggerOsc9("chan-001", "Build complete!");

		const notifMsgs = sent.filter((m) => m.type === "NOTIFICATION");
		expect(notifMsgs).toHaveLength(1);
		const msg = notifMsgs[0] as { type: string; channelId: string; message: string };
		expect(msg.channelId).toBe("chan-001");
		expect(msg.message).toBe("Build complete!");
	});

	it("OSC 9 sanitizes HTML and control chars", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-osc9-sanitize",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		mock._triggerOsc9("chan-001", '<script>alert("xss")</script>\x07Hello\x1bWorld');

		const notifMsgs = sent.filter((m) => m.type === "NOTIFICATION");
		expect(notifMsgs).toHaveLength(1);
		const msg = notifMsgs[0] as { type: string; message: string };
		expect(msg.message).toBe('alert("xss")HelloWorld');
	});

	it("OSC 9 truncates message to 256 chars", () => {
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-osc9-trunc",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		const longMessage = "A".repeat(500);
		mock._triggerOsc9("chan-001", longMessage);

		const notifMsgs = sent.filter((m) => m.type === "NOTIFICATION");
		expect(notifMsgs).toHaveLength(1);
		const msg = notifMsgs[0] as { type: string; message: string };
		expect(msg.message).toHaveLength(256);
	});

	it("rapid OSC 9 notifications are throttled to 1 per 500ms", () => {
		vi.useFakeTimers();
		const { handler, sent } = makeHandler(mock);
		pushMsg(handler, {
			type: "SPAWN",
			requestId: "req-osc9-throttle",
			shell: "/bin/bash",
			cwd: "/tmp",
			env: {},
			cols: 80,
			rows: 24,
		});

		// Fire 5 OSC 9 notifications rapidly at t=0
		for (let i = 0; i < 5; i++) {
			mock._triggerOsc9("chan-001", `Notification ${i}`);
		}

		// Only 1 should have been sent
		expect(sent.filter((m) => m.type === "NOTIFICATION")).toHaveLength(1);
		const msg = sent.filter((m) => m.type === "NOTIFICATION")[0] as { message: string };
		expect(msg.message).toBe("Notification 0");

		// Advance past throttle window
		vi.advanceTimersByTime(500);

		// Now another should be allowed
		mock._triggerOsc9("chan-001", "Notification 5");
		expect(sent.filter((m) => m.type === "NOTIFICATION")).toHaveLength(2);

		vi.useRealTimers();
	});
});
