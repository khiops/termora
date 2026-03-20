/**
 * pty.spec.ts
 *
 * Unit tests for PtyManager — focuses on the SEA-mode useConpty guard.
 * node-pty and sea-addon-loader are fully mocked so no real PTY is created.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock state so vi.mock factories can reference it.
// ---------------------------------------------------------------------------

const { detectSeaMock, ptySpawnMock } = vi.hoisted(() => ({
	detectSeaMock: vi.fn(() => false),
	ptySpawnMock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — factories only reference hoisted variables (safe).
// ---------------------------------------------------------------------------

vi.mock("./sea-addon-loader.js", () => ({
	detectSea: detectSeaMock,
}));

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

	it("spawns with correct base options in dev mode", () => {
		detectSeaMock.mockReturnValue(false);

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

	it("does NOT set useConpty in dev mode (leaves conpty as node-pty default)", () => {
		detectSeaMock.mockReturnValue(false);

		manager.spawn(BASE_OPTIONS);

		const [, , opts] = ptySpawnMock.mock.calls[0] as [
			string,
			string[],
			Record<string, unknown>,
		];
		// useConpty must be absent (not forced), so node-pty applies its own default.
		expect(opts).not.toHaveProperty("useConpty");
	});

	it("sets useConpty: false in SEA mode to force winpty (the only embedded native)", () => {
		detectSeaMock.mockReturnValue(true);

		manager.spawn(BASE_OPTIONS);

		const [, , opts] = ptySpawnMock.mock.calls[0] as [
			string,
			string[],
			Record<string, unknown>,
		];
		expect(opts.useConpty).toBe(false);
	});

	it("returns a channel id", () => {
		detectSeaMock.mockReturnValue(false);

		const id = manager.spawn(BASE_OPTIONS);
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("accepts a custom channel id via options.id", () => {
		detectSeaMock.mockReturnValue(false);

		const id = manager.spawn({ ...BASE_OPTIONS, id: "my-custom-id" });
		expect(id).toBe("my-custom-id");
	});

	it("merges process.env with provided env vars", () => {
		detectSeaMock.mockReturnValue(false);

		const originalEnv = process.env;
		process.env = { EXISTING: "yes" };

		manager.spawn({ ...BASE_OPTIONS, env: { CUSTOM: "value" } });

		const [, , opts] = ptySpawnMock.mock.calls[0] as [
			string,
			string[],
			Record<string, unknown>,
		];
		expect((opts.env as Record<string, string>)["EXISTING"]).toBe("yes");
		expect((opts.env as Record<string, string>)["CUSTOM"]).toBe("value");

		process.env = originalEnv;
	});
});
