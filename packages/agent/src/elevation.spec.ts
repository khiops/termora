import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs and node:os at module level so ESM exports are patchable.
// vi.mock calls are hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------

const mockWriteFileSync = vi.fn();
const mockChmodSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockTmpdir = vi.fn(() => "/tmp");

vi.mock("node:fs", () => ({
	writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
	chmodSync: (...args: unknown[]) => mockChmodSync(...args),
	unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock("node:os", () => ({
	tmpdir: () => mockTmpdir(),
}));

// Import AFTER mocks are set up.
import { buildAskpassEnv, wrapWithElevation } from "./elevation.js";

// ---------------------------------------------------------------------------
// SC-18: ASKPASS mechanism (Linux/macOS)
// ---------------------------------------------------------------------------

describe("buildAskpassEnv", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTmpdir.mockReturnValue("/tmp");
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("on Linux (platform !== 'win32')", () => {
		it("SC-18: creates temp script with correct content and chmod 700", () => {
			const result = buildAskpassEnv("mypassword", "linux");

			// tmpdir consulted
			expect(mockTmpdir).toHaveBeenCalled();

			// writeFileSync called with the script content and mode 0o700
			expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
			const [filePath, content, options] = mockWriteFileSync.mock.calls[0] as [
				string,
				string,
				{ mode: number },
			];
			expect(filePath).toMatch(/^\/tmp\/nexterm-askpass-[0-9a-f]+$/);
			// Script must NOT embed the secret in shell syntax (injection prevention)
			expect(content).not.toContain("mypassword");
			// Script must reference the secret via env variable
			expect(content).toBe('#!/bin/sh\necho "$_NEXTERM_ELEV"');
			expect(options?.mode).toBe(0o700);

			// chmod 700 applied explicitly
			expect(mockChmodSync).toHaveBeenCalledWith(filePath, 0o700);

			// env contains SUDO_ASKPASS pointing to the temp file
			// AND _NEXTERM_ELEV carrying the secret (never in shell syntax)
			expect(result.env).toEqual({ SUDO_ASKPASS: filePath, _NEXTERM_ELEV: "mypassword" });
		});

		it("SC-18: cleanup removes the temp file", () => {
			const result = buildAskpassEnv("mypassword", "linux");

			const filePath = result.env.SUDO_ASKPASS;
			expect(filePath).toBeTruthy();

			result.cleanup();

			expect(mockUnlinkSync).toHaveBeenCalledWith(filePath);
		});

		it("SC-18: cleanup ignores ENOENT (file already gone)", () => {
			const result = buildAskpassEnv("mypassword", "linux");

			const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			mockUnlinkSync.mockImplementation(() => {
				throw enoentError;
			});

			// Should not throw
			expect(() => result.cleanup()).not.toThrow();
		});

		it("SC-18: cleanup rethrows non-ENOENT errors", () => {
			const result = buildAskpassEnv("mypassword", "linux");

			const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });
			mockUnlinkSync.mockImplementation(() => {
				throw epermError;
			});

			expect(() => result.cleanup()).toThrow("EPERM");
		});

		it("SC-18: each call produces a unique temp file path", () => {
			const r1 = buildAskpassEnv("pass1", "linux");
			const r2 = buildAskpassEnv("pass2", "linux");

			expect(r1.env.SUDO_ASKPASS).not.toBe(r2.env.SUDO_ASKPASS);
		});
	});

	describe("on macOS (darwin)", () => {
		it("creates ASKPASS script (same as Linux)", () => {
			mockTmpdir.mockReturnValue("/var/folders/tmp");

			const result = buildAskpassEnv("darwinpass", "darwin");

			expect(result.env.SUDO_ASKPASS).toMatch(/^\/var\/folders\/tmp\/nexterm-askpass-/);
			expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
			const [, content] = mockWriteFileSync.mock.calls[0] as [string, string];
			// Secret carried via env variable, not embedded in script
			expect(content).toBe('#!/bin/sh\necho "$_NEXTERM_ELEV"');
			expect(result.env._NEXTERM_ELEV).toBe("darwinpass");
		});
	});

	describe("on Windows (platform === 'win32')", () => {
		it("returns empty env and no-op cleanup", () => {
			const result = buildAskpassEnv("ignored", "win32");

			expect(result.env).toEqual({});
			// cleanup is a no-op — must not throw
			expect(() => result.cleanup()).not.toThrow();
			// No file system operations on Windows
			expect(mockWriteFileSync).not.toHaveBeenCalled();
			expect(mockChmodSync).not.toHaveBeenCalled();
		});
	});
});

// ---------------------------------------------------------------------------
// SC-18b / SC-18c: wrapWithElevation
// ---------------------------------------------------------------------------

describe("wrapWithElevation", () => {
	it("SC-18b: wraps with sudo -A -E -- on Linux", () => {
		const result = wrapWithElevation("/bin/bash", ["-l"], "linux");
		expect(result).toEqual({
			shell: "sudo",
			args: ["-A", "-E", "--", "/bin/bash", "-l"],
		});
	});

	it("SC-18b: wraps with sudo on Darwin", () => {
		const result = wrapWithElevation("/bin/zsh", [], "darwin");
		expect(result).toEqual({
			shell: "sudo",
			args: ["-A", "-E", "--", "/bin/zsh"],
		});
	});

	it("SC-18c: wraps with gsudo on Windows", () => {
		const result = wrapWithElevation("cmd.exe", ["/k"], "win32");
		expect(result).toEqual({
			shell: "gsudo",
			args: ["cmd.exe", "/k"],
		});
	});

	it("preserves empty args array", () => {
		const result = wrapWithElevation("/bin/sh", [], "linux");
		expect(result).toEqual({
			shell: "sudo",
			args: ["-A", "-E", "--", "/bin/sh"],
		});
	});

	it("preserves multiple args on Windows", () => {
		const result = wrapWithElevation("powershell.exe", ["-NoProfile", "-Command", "dir"], "win32");
		expect(result).toEqual({
			shell: "gsudo",
			args: ["powershell.exe", "-NoProfile", "-Command", "dir"],
		});
	});
});
