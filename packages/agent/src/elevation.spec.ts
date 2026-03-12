import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs and node:os at module level so ESM exports are patchable.
// vi.mock calls are hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------

const mockWriteFileSync = vi.fn();
const mockChmodSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockTmpdir = vi.fn(() => "/tmp");
const mockSpawnSync = vi.fn();

vi.mock("node:fs", () => ({
	writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
	chmodSync: (...args: unknown[]) => mockChmodSync(...args),
	unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock("node:os", () => ({
	tmpdir: () => mockTmpdir(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

// Import AFTER mocks are set up.
import { buildAskpassEnv, checkPasswordless, wrapWithElevation } from "./elevation.js";

// ---------------------------------------------------------------------------
// SC-18: ASKPASS mechanism — buildAskpassEnv
// ---------------------------------------------------------------------------

describe("buildAskpassEnv", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockTmpdir.mockReturnValue("/tmp");
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("method=sudo on Linux", () => {
		it("SC-18: creates temp script with correct content, chmod 700, and sets SUDO_ASKPASS", () => {
			const result = buildAskpassEnv("mypassword", "sudo", "linux");

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
			const result = buildAskpassEnv("mypassword", "sudo", "linux");

			const filePath = result.env.SUDO_ASKPASS;
			expect(filePath).toBeTruthy();

			result.cleanup();

			expect(mockUnlinkSync).toHaveBeenCalledWith(filePath);
		});

		it("SC-18: cleanup ignores ENOENT (file already gone)", () => {
			const result = buildAskpassEnv("mypassword", "sudo", "linux");

			const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			mockUnlinkSync.mockImplementation(() => {
				throw enoentError;
			});

			// Should not throw
			expect(() => result.cleanup()).not.toThrow();
		});

		it("SC-18: cleanup rethrows non-ENOENT errors", () => {
			const result = buildAskpassEnv("mypassword", "sudo", "linux");

			const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });
			mockUnlinkSync.mockImplementation(() => {
				throw epermError;
			});

			expect(() => result.cleanup()).toThrow("EPERM");
		});

		it("SC-18: each call produces a unique temp file path", () => {
			const r1 = buildAskpassEnv("pass1", "sudo", "linux");
			const r2 = buildAskpassEnv("pass2", "sudo", "linux");

			expect(r1.env.SUDO_ASKPASS).not.toBe(r2.env.SUDO_ASKPASS);
		});
	});

	describe("method=sudo on macOS (darwin)", () => {
		it("creates ASKPASS script (same as Linux)", () => {
			mockTmpdir.mockReturnValue("/var/folders/tmp");

			const result = buildAskpassEnv("darwinpass", "sudo", "darwin");

			expect(result.env.SUDO_ASKPASS).toMatch(/^\/var\/folders\/tmp\/nexterm-askpass-/);
			expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
			const [, content] = mockWriteFileSync.mock.calls[0] as [string, string];
			// Secret carried via env variable, not embedded in script
			expect(content).toBe('#!/bin/sh\necho "$_NEXTERM_ELEV"');
			expect(result.env._NEXTERM_ELEV).toBe("darwinpass");
		});
	});

	describe("method=doas on Linux", () => {
		it("creates DOAS_ASKPASS script and sets DOAS_ASKPASS env var", () => {
			const result = buildAskpassEnv("doaspass", "doas", "linux");

			expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
			const [filePath] = mockWriteFileSync.mock.calls[0] as [string];
			expect(filePath).toMatch(/^\/tmp\/nexterm-askpass-[0-9a-f]+$/);

			expect(result.env).toEqual({ DOAS_ASKPASS: filePath, _NEXTERM_ELEV: "doaspass" });
			// SUDO_ASKPASS must NOT be set for doas
			expect(result.env.SUDO_ASKPASS).toBeUndefined();
		});

		it("cleanup removes the doas askpass temp file", () => {
			const result = buildAskpassEnv("doaspass", "doas", "linux");
			const filePath = result.env.DOAS_ASKPASS;
			expect(filePath).toBeTruthy();
			result.cleanup();
			expect(mockUnlinkSync).toHaveBeenCalledWith(filePath);
		});
	});

	describe("method=pkexec", () => {
		it("returns empty env and no-op cleanup", () => {
			const result = buildAskpassEnv("ignored", "pkexec", "linux");
			expect(result.env).toEqual({});
			expect(() => result.cleanup()).not.toThrow();
			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});
	});

	describe("method=gsudo (Windows)", () => {
		it("returns empty env and no-op cleanup", () => {
			const result = buildAskpassEnv("ignored", "gsudo", "win32");
			expect(result.env).toEqual({});
			expect(() => result.cleanup()).not.toThrow();
			expect(mockWriteFileSync).not.toHaveBeenCalled();
			expect(mockChmodSync).not.toHaveBeenCalled();
		});
	});

	describe("method=custom", () => {
		it("returns empty env and no-op cleanup", () => {
			const result = buildAskpassEnv("ignored", "custom", "linux");
			expect(result.env).toEqual({});
			expect(() => result.cleanup()).not.toThrow();
			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});
	});

	describe("win32 platform always no-op (regardless of method)", () => {
		it("sudo on win32 returns empty env", () => {
			const result = buildAskpassEnv("pass", "sudo", "win32");
			expect(result.env).toEqual({});
			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});
	});
});

// ---------------------------------------------------------------------------
// checkPasswordless
// ---------------------------------------------------------------------------

describe("checkPasswordless", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("sudo: returns true when sudo -n true exits 0", () => {
		mockSpawnSync.mockReturnValue({ status: 0 });
		expect(checkPasswordless("sudo", "linux")).toBe(true);
		expect(mockSpawnSync).toHaveBeenCalledWith("sudo", ["-n", "true"], { timeout: 3000 });
	});

	it("sudo: returns false when sudo -n true exits non-zero", () => {
		mockSpawnSync.mockReturnValue({ status: 1 });
		expect(checkPasswordless("sudo", "linux")).toBe(false);
	});

	it("doas: returns true when doas -n true exits 0", () => {
		mockSpawnSync.mockReturnValue({ status: 0 });
		expect(checkPasswordless("doas", "linux")).toBe(true);
		expect(mockSpawnSync).toHaveBeenCalledWith("doas", ["-n", "true"], { timeout: 3000 });
	});

	it("doas: returns false when doas -n true exits non-zero", () => {
		mockSpawnSync.mockReturnValue({ status: 1 });
		expect(checkPasswordless("doas", "linux")).toBe(false);
	});

	it("pkexec: always returns false (always requires auth agent)", () => {
		expect(checkPasswordless("pkexec", "linux")).toBe(false);
		expect(mockSpawnSync).not.toHaveBeenCalled();
	});

	it("gsudo: always returns true (UAC prompt or cached token)", () => {
		expect(checkPasswordless("gsudo", "win32")).toBe(true);
		expect(mockSpawnSync).not.toHaveBeenCalled();
	});

	it("custom: always returns true (no way to detect)", () => {
		expect(checkPasswordless("custom", "linux")).toBe(true);
		expect(mockSpawnSync).not.toHaveBeenCalled();
	});

	it("unknown method: returns false", () => {
		expect(checkPasswordless("unknown", "linux")).toBe(false);
		expect(mockSpawnSync).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// SC-18b / SC-18c: wrapWithElevation
// ---------------------------------------------------------------------------

describe("wrapWithElevation", () => {
	describe("method=sudo", () => {
		it("SC-18b: askpass mode uses -A -H -E -- on Linux", () => {
			const result = wrapWithElevation("/bin/bash", ["-l"], "sudo", "askpass", "linux");
			expect(result).toEqual({
				shell: "sudo",
				args: ["-A", "-H", "-E", "--", "/bin/bash", "-l"],
			});
		});

		it("SC-18b: askpass mode uses -A -H -E -- on Darwin", () => {
			const result = wrapWithElevation("/bin/zsh", [], "sudo", "askpass", "darwin");
			expect(result).toEqual({
				shell: "sudo",
				args: ["-A", "-H", "-E", "--", "/bin/zsh"],
			});
		});

		it("passwordless mode uses -n -H -E -- on Linux", () => {
			const result = wrapWithElevation("/bin/bash", [], "sudo", "passwordless", "linux");
			expect(result).toEqual({
				shell: "sudo",
				args: ["-n", "-H", "-E", "--", "/bin/bash"],
			});
		});
	});

	describe("method=doas", () => {
		it("askpass mode uses doas -- on Linux", () => {
			const result = wrapWithElevation("/bin/bash", ["-l"], "doas", "askpass", "linux");
			expect(result).toEqual({
				shell: "doas",
				args: ["--", "/bin/bash", "-l"],
			});
		});

		it("passwordless mode uses doas -n -- on Linux", () => {
			const result = wrapWithElevation("/bin/bash", [], "doas", "passwordless", "linux");
			expect(result).toEqual({
				shell: "doas",
				args: ["-n", "--", "/bin/bash"],
			});
		});
	});

	describe("method=pkexec", () => {
		it("uses --disable-internal-agent regardless of mode", () => {
			const result = wrapWithElevation("/bin/bash", [], "pkexec", "askpass", "linux");
			expect(result).toEqual({
				shell: "pkexec",
				args: ["--disable-internal-agent", "/bin/bash"],
			});
		});
	});

	describe("method=gsudo", () => {
		it("SC-18c: wraps with gsudo on Windows", () => {
			const result = wrapWithElevation("cmd.exe", ["/k"], "gsudo", "askpass", "win32");
			expect(result).toEqual({
				shell: "gsudo",
				args: ["cmd.exe", "/k"],
			});
		});

		it("passwordless mode also wraps with gsudo", () => {
			const result = wrapWithElevation("powershell.exe", [], "gsudo", "passwordless", "win32");
			expect(result).toEqual({
				shell: "gsudo",
				args: ["powershell.exe"],
			});
		});
	});

	describe("method=custom", () => {
		it("uses customCommand as the binary with -- separator", () => {
			const result = wrapWithElevation("/bin/bash", [], "custom", "askpass", "linux", "my-sudo");
			expect(result).toEqual({
				shell: "my-sudo",
				args: ["--", "/bin/bash"],
			});
		});

		it("throws when customCommand is not provided", () => {
			expect(() => wrapWithElevation("/bin/bash", [], "custom", "askpass", "linux")).toThrow(
				"customCommand is required",
			);
		});

		it("passes args after -- separator", () => {
			const result = wrapWithElevation(
				"/bin/bash",
				["-l", "-c", "ls"],
				"custom",
				"passwordless",
				"linux",
				"my-sudo",
			);
			expect(result).toEqual({
				shell: "my-sudo",
				args: ["--", "/bin/bash", "-l", "-c", "ls"],
			});
		});
	});

	describe("unknown method", () => {
		it("passes through unchanged as safe fallback", () => {
			const result = wrapWithElevation("/bin/bash", ["-l"], "unknown", "askpass", "linux");
			expect(result).toEqual({ shell: "/bin/bash", args: ["-l"] });
		});
	});
});
