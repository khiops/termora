import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PROCESS_TITLE_POLL_MS,
	getForegroundProcessName,
	startProcessTitlePolling,
} from "./process-title.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";
const mockReadFileSync = vi.mocked(readFileSync);

// ---------------------------------------------------------------------------
// getForegroundProcessName
// ---------------------------------------------------------------------------

describe("getForegroundProcessName", () => {
	const origPlatform = process.platform;

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: origPlatform });
		vi.clearAllMocks();
	});

	function setPlatform(p: NodeJS.Platform) {
		Object.defineProperty(process, "platform", { value: p });
	}

	it("returns null on non-linux platforms", () => {
		setPlatform("darwin");
		expect(getForegroundProcessName(1234)).toBeNull();
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	it("returns null on win32", () => {
		setPlatform("win32");
		expect(getForegroundProcessName(1234)).toBeNull();
	});

	it("returns the foreground process name on linux", () => {
		setPlatform("linux");
		// /proc/1234/stat: pid (comm) state ppid pgrp session tty_nr tpgid ...
		// tpgid is at index 5 after the last ')'
		mockReadFileSync
			.mockReturnValueOnce("1234 (bash) S 1233 1234 1234 34816 5678 0 0 0") // stat
			.mockReturnValueOnce("vim\n"); // /proc/5678/comm
		const result = getForegroundProcessName(1234);
		expect(result).toBe("vim");
		expect(mockReadFileSync).toHaveBeenCalledWith("/proc/1234/stat", "utf8");
		expect(mockReadFileSync).toHaveBeenCalledWith("/proc/5678/comm", "utf8");
	});

	it("handles comm field with spaces and parens", () => {
		setPlatform("linux");
		// comm can contain spaces and parens: "(my prog)"
		mockReadFileSync
			.mockReturnValueOnce("100 (my (prog)) S 99 100 100 34816 200 0 0 0")
			.mockReturnValueOnce("node\n");
		expect(getForegroundProcessName(100)).toBe("node");
	});

	it("returns null when tpgid is 0", () => {
		setPlatform("linux");
		// tpgid = 0 means no foreground process group
		mockReadFileSync.mockReturnValueOnce("1 (init) S 0 1 1 0 0 0 0 0");
		expect(getForegroundProcessName(1)).toBeNull();
	});

	it("returns null when tpgid is negative", () => {
		setPlatform("linux");
		mockReadFileSync.mockReturnValueOnce("1 (init) S 0 1 1 0 -1 0 0 0");
		expect(getForegroundProcessName(1)).toBeNull();
	});

	it("returns null when stat has no closing paren", () => {
		setPlatform("linux");
		mockReadFileSync.mockReturnValueOnce("1 init S 0 1 1 0 5 0 0 0");
		expect(getForegroundProcessName(1)).toBeNull();
	});

	it("returns null when fields[5] is missing", () => {
		setPlatform("linux");
		// Too few fields after last ')'
		mockReadFileSync.mockReturnValueOnce("1 (sh) S 0");
		expect(getForegroundProcessName(1)).toBeNull();
	});

	it("returns null when comm file is empty", () => {
		setPlatform("linux");
		mockReadFileSync
			.mockReturnValueOnce("1234 (bash) S 1233 1234 1234 34816 5678 0 0 0")
			.mockReturnValueOnce("   \n"); // whitespace-only
		expect(getForegroundProcessName(1234)).toBeNull();
	});

	it("returns null when readFileSync throws", () => {
		setPlatform("linux");
		mockReadFileSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		expect(getForegroundProcessName(9999)).toBeNull();
	});

	it("returns null when comm readFileSync throws", () => {
		setPlatform("linux");
		mockReadFileSync
			.mockReturnValueOnce("1234 (bash) S 1233 1234 1234 34816 5678 0 0 0")
			.mockImplementationOnce(() => {
				throw new Error("ENOENT");
			});
		expect(getForegroundProcessName(1234)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// startProcessTitlePolling
// ---------------------------------------------------------------------------

describe("startProcessTitlePolling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(process, "platform", { value: "linux" });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		Object.defineProperty(process, "platform", { value: process.platform });
	});

	it("calls onChange when process name changes", () => {
		const onChange = vi.fn();
		// First poll: "bash", second poll: "vim"
		mockReadFileSync
			.mockReturnValueOnce("1 (sh) S 0 1 1 0 42 0 0") // stat → tpgid=42
			.mockReturnValueOnce("bash\n") // comm
			.mockReturnValueOnce("1 (sh) S 0 1 1 0 43 0 0") // stat → tpgid=43
			.mockReturnValueOnce("vim\n"); // comm

		const stop = startProcessTitlePolling(1, onChange, 100);

		vi.advanceTimersByTime(100);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith("bash");

		vi.advanceTimersByTime(100);
		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange).toHaveBeenCalledWith("vim");

		stop();
	});

	it("does not call onChange when process name stays the same", () => {
		const onChange = vi.fn();
		mockReadFileSync
			.mockReturnValue("1 (sh) S 0 1 1 0 42 0 0") // always same tpgid
			.mockReturnValue("bash\n"); // always same comm
		// Make both calls return consistently
		mockReadFileSync.mockImplementation((path: unknown) => {
			if (typeof path === "string" && path.endsWith("/stat")) {
				return "1 (sh) S 0 1 1 0 42 0 0";
			}
			return "bash\n";
		});

		const stop = startProcessTitlePolling(1, onChange, 100);

		vi.advanceTimersByTime(100); // first poll → onChange("bash")
		vi.advanceTimersByTime(100); // second poll → same, no call
		vi.advanceTimersByTime(100); // third poll → same, no call

		expect(onChange).toHaveBeenCalledTimes(1);
		stop();
	});

	it("does not call onChange when getForegroundProcessName returns null", () => {
		const onChange = vi.fn();
		mockReadFileSync.mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const stop = startProcessTitlePolling(1, onChange, 100);
		vi.advanceTimersByTime(500);
		expect(onChange).not.toHaveBeenCalled();
		stop();
	});

	it("stop function cancels the interval", () => {
		const onChange = vi.fn();
		mockReadFileSync.mockImplementation((path: unknown) => {
			if (typeof path === "string" && path.endsWith("/stat")) {
				return "1 (sh) S 0 1 1 0 42 0 0";
			}
			return "bash\n";
		});

		const stop = startProcessTitlePolling(1, onChange, 100);
		vi.advanceTimersByTime(100); // first poll fires
		stop(); // cancel
		vi.advanceTimersByTime(1000); // no more polls

		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("uses PROCESS_TITLE_POLL_MS as default interval", () => {
		expect(PROCESS_TITLE_POLL_MS).toBe(500);
	});
});
