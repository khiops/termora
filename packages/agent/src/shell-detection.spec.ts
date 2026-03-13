import { constants } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// We need to control fs/promises imports inside shell-detection.ts.
// Use vi.mock with a factory — hoisted automatically by vitest.
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn<[string, BufferEncoding], Promise<string>>();
const mockAccess = vi.fn<[string, number?], Promise<void>>();

vi.mock("node:fs/promises", () => ({
	readFile: (...args: Parameters<typeof mockReadFile>) => mockReadFile(...args),
	access: (...args: Parameters<typeof mockAccess>) => mockAccess(...args),
	constants,
}));

import { _resetShellCache, detectAvailableShells, getDefaultShell } from "./shell-detection.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make access resolve (exists/executable) for the given path set. */
function mockExecutable(paths: Set<string>): void {
	mockAccess.mockImplementation(async (p: string) => {
		if (paths.has(p)) return;
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
	});
}

// ---------------------------------------------------------------------------
// SC-21: Linux/macOS shell detection
// ---------------------------------------------------------------------------

describe("detectAvailableShells — Linux/macOS", () => {
	const originalPlatform = process.platform;

	beforeEach(() => {
		_resetShellCache();
		// Force non-Windows so the Unix branch runs regardless of CI host.
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
		});
		vi.clearAllMocks();
	});

	it("SC-21: returns filtered, sorted, deduplicated shells from /etc/shells", async () => {
		mockReadFile.mockResolvedValue(
			[
				"# /etc/shells: valid login shells",
				"",
				"/bin/sh",
				"/bin/bash",
				"/usr/bin/fish",
				"/bin/zsh",
				"/bin/bash", // duplicate
				"/nonexistent/shell",
			].join("\n"),
		);

		// Only /bin/sh, /bin/bash, /bin/zsh are "executable"
		const executable = new Set(["/bin/sh", "/bin/bash", "/bin/zsh"]);
		mockExecutable(executable);

		const shells = await detectAvailableShells();

		// Sorted, deduplicated
		expect(shells).toEqual(["/bin/bash", "/bin/sh", "/bin/zsh"]);
		// /usr/bin/fish and /nonexistent/shell are absent
		expect(shells).not.toContain("/usr/bin/fish");
		expect(shells).not.toContain("/nonexistent/shell");
	});

	it("returns empty array when /etc/shells does not exist", async () => {
		mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		mockAccess.mockResolvedValue(undefined);

		const shells = await detectAvailableShells();
		expect(shells).toEqual([]);
	});

	it("skips blank lines and comment lines", async () => {
		mockReadFile.mockResolvedValue(
			["# comment", "", "  ", "/bin/bash", "# another comment"].join("\n"),
		);
		mockExecutable(new Set(["/bin/bash"]));

		const shells = await detectAvailableShells();
		expect(shells).toEqual(["/bin/bash"]);
	});

	it("caches results across multiple calls", async () => {
		mockReadFile.mockResolvedValue("/bin/bash\n");
		mockExecutable(new Set(["/bin/bash"]));

		const first = await detectAvailableShells();
		const second = await detectAvailableShells();

		// readFile should only be called once
		expect(mockReadFile).toHaveBeenCalledOnce();
		expect(first).toBe(second); // same reference
	});
});

// ---------------------------------------------------------------------------
// SC-22: Windows shell detection
// ---------------------------------------------------------------------------

describe("detectAvailableShells — Windows", () => {
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		_resetShellCache();
		Object.defineProperty(process, "platform", {
			value: "win32",
			configurable: true,
		});

		// Set up a minimal Windows-like environment
		process.env.SYSTEMROOT = "C:\\Windows";
		process.env.ProgramFiles = "C:\\Program Files";
		process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
		// biome-ignore lint/performance/noDelete: env var must be absent (undefined assignment sets the string "undefined")
		delete process.env["ProgramFiles(x86)"];
		// Ensure COMSPEC is set
		process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
		});
		// Restore env — delete is required here: assigning undefined sets the string "undefined"
		for (const key of Object.keys(process.env)) {
			// biome-ignore lint/performance/noDelete: env var must be absent (undefined assignment sets string "undefined")
			if (!(key in originalEnv)) delete process.env[key];
		}
		Object.assign(process.env, originalEnv);
		vi.clearAllMocks();
	});

	it("SC-22: detects shells at known Windows paths", async () => {
		const executable = new Set([
			"C:\\Windows\\System32\\cmd.exe",
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		]);
		// F_OK check — accessible paths succeed
		mockAccess.mockImplementation(async (p: string) => {
			if (executable.has(p)) return;
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});

		const shells = await detectAvailableShells();

		expect(shells).toContain("C:\\Windows\\System32\\cmd.exe");
		expect(shells).toContain("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
		// pwsh.exe not installed — not in result
		expect(shells).not.toContain("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
	});

	it("SC-22: includes ProgramFiles(x86) pwsh path when env var is set", async () => {
		process.env["ProgramFiles(x86)"] = "C:\\Program Files (x86)";

		const executable = new Set(["C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe"]);
		mockAccess.mockImplementation(async (p: string) => {
			if (executable.has(p)) return;
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});

		const shells = await detectAvailableShells();
		expect(shells).toContain("C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe");
	});

	it("SC-22: returns empty array when no known shells are found", async () => {
		mockAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

		const shells = await detectAvailableShells();
		expect(shells).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// getDefaultShell
// ---------------------------------------------------------------------------

describe("getDefaultShell", () => {
	const originalPlatform = process.platform;
	const originalShell = process.env.SHELL;
	const originalComspec = process.env.COMSPEC;

	afterEach(() => {
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
		});
		if (originalShell !== undefined) {
			process.env.SHELL = originalShell;
		} else {
			// biome-ignore lint/performance/noDelete: env var must be absent (undefined assignment sets string "undefined")
			delete process.env.SHELL;
		}
		if (originalComspec !== undefined) {
			process.env.COMSPEC = originalComspec;
		} else {
			// biome-ignore lint/performance/noDelete: env var must be absent (undefined assignment sets string "undefined")
			delete process.env.COMSPEC;
		}
		_resetShellCache();
	});

	it("returns $SHELL on Linux when set", () => {
		Object.defineProperty(process, "platform", {
			value: "linux",
			configurable: true,
		});
		process.env.SHELL = "/usr/bin/zsh";
		expect(getDefaultShell()).toBe("/usr/bin/zsh");
	});

	it("falls back to /bin/sh on Linux when $SHELL is unset", () => {
		Object.defineProperty(process, "platform", {
			value: "linux",
			configurable: true,
		});
		// biome-ignore lint/performance/noDelete: env var must be absent (undefined assignment sets string "undefined")
		delete process.env.SHELL;
		expect(getDefaultShell()).toBe("/bin/sh");
	});

	it("returns %COMSPEC% on Windows when set", () => {
		Object.defineProperty(process, "platform", {
			value: "win32",
			configurable: true,
		});
		process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
		expect(getDefaultShell()).toBe("C:\\Windows\\System32\\cmd.exe");
	});

	it("falls back to cmd.exe on Windows when %COMSPEC% is unset", () => {
		Object.defineProperty(process, "platform", {
			value: "win32",
			configurable: true,
		});
		// biome-ignore lint/performance/noDelete: env var must be absent (undefined assignment sets string "undefined")
		delete process.env.COMSPEC;
		expect(getDefaultShell()).toBe("cmd.exe");
	});
});
