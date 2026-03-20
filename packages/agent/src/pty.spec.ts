/**
 * pty.spec.ts
 *
 * Unit tests for PtyManager.
 * node-pty is fully mocked so no real PTY is created.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock state so vi.mock factories can reference it.
// ---------------------------------------------------------------------------

const { ptySpawnMock } = vi.hoisted(() => ({
	ptySpawnMock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — factories only reference hoisted variables (safe).
// ---------------------------------------------------------------------------

vi.mock("node-pty", () => ({
	spawn: ptySpawnMock,
}));

vi.mock("@nexterm/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@nexterm/shared")>();
	return {
		...actual,
		generateId: () => "test-channel-id",
	};
});

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered.
// ---------------------------------------------------------------------------

import { PtyManager } from "./pty.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakePty() {
	return {
		pid: 1234,
		process: "bash",
		onData: vi.fn(),
		onExit: vi.fn(),
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(),
	};
}

const BASE_OPTIONS = {
	shell: "/bin/bash",
	args: [],
	cwd: "/home/user",
	env: {},
	cols: 80,
	rows: 24,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PtyManager.spawn", () => {
	let manager: PtyManager;

	beforeEach(() => {
		manager = new PtyManager();
		ptySpawnMock.mockReturnValue(makeFakePty());
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("spawns with correct base options", () => {
		manager.spawn(BASE_OPTIONS);

		expect(ptySpawnMock).toHaveBeenCalledOnce();
		const [shell, args, opts] = ptySpawnMock.mock.calls[0] as [
			string,
			string[],
			Record<string, unknown>,
		];
		expect(shell).toBe("/bin/bash");
		expect(args).toEqual([]);
		expect(opts.name).toBe("xterm-256color");
		expect(opts.cols).toBe(80);
		expect(opts.rows).toBe(24);
		expect(opts.cwd).toBe("/home/user");
	});

	it("does NOT set useConpty (both conpty.node and pty.node are embedded; node-pty chooses)", () => {
		manager.spawn(BASE_OPTIONS);

		const [, , opts] = ptySpawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
		expect(opts).not.toHaveProperty("useConpty");
	});

	it("returns a channel id", () => {
		const id = manager.spawn(BASE_OPTIONS);
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("accepts a custom channel id via options.id", () => {
		const id = manager.spawn({ ...BASE_OPTIONS, id: "my-custom-id" });
		expect(id).toBe("my-custom-id");
	});

	it("merges process.env with provided env vars", () => {
		const originalEnv = process.env;
		process.env = { EXISTING: "yes" };

		manager.spawn({ ...BASE_OPTIONS, env: { CUSTOM: "value" } });

		const [, , opts] = ptySpawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
		expect((opts.env as Record<string, string>).EXISTING).toBe("yes");
		expect((opts.env as Record<string, string>).CUSTOM).toBe("value");

		process.env = originalEnv;
	});
});
