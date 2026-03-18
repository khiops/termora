import { describe, expect, it } from "vitest";
import {
	MAX_ENV_COUNT,
	MAX_INPUT_SIZE,
	isValidDimensions,
	isValidEnv,
	isValidInputData,
	isValidUlid,
	validateCustomCommand,
} from "./validation.js";

describe("isValidUlid", () => {
	it("accepts a valid ULID", () => {
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
	});

	it("accepts lowercase ULID", () => {
		expect(isValidUlid("01arz3ndektsv4rrffq69g5fav")).toBe(true);
	});

	it("rejects empty string", () => {
		expect(isValidUlid("")).toBe(false);
	});

	it("rejects wrong length (25 chars)", () => {
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
	});

	it("rejects wrong length (27 chars)", () => {
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAVX")).toBe(false);
	});

	it("rejects invalid characters (I, L, O, U are excluded from Crockford base32)", () => {
		// 'I' is not valid in Crockford base32
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQI9G5FAV")).toBe(false);
		// 'L' is not valid
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQL9G5FAV")).toBe(false);
		// 'O' is not valid
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQO9G5FAV")).toBe(false);
		// 'U' is not valid
		expect(isValidUlid("01ARZ3NDEKTSV4RRFFQU9G5FAV")).toBe(false);
	});

	it("rejects non-string types", () => {
		expect(isValidUlid(123)).toBe(false);
		expect(isValidUlid(null)).toBe(false);
		expect(isValidUlid(undefined)).toBe(false);
		expect(isValidUlid({})).toBe(false);
		expect(isValidUlid([])).toBe(false);
	});
});

describe("isValidDimensions", () => {
	it("accepts valid dimensions", () => {
		expect(isValidDimensions(80, 24)).toBe(true);
	});

	it("accepts boundary values (1x1)", () => {
		expect(isValidDimensions(1, 1)).toBe(true);
	});

	it("accepts boundary values (500x500)", () => {
		expect(isValidDimensions(500, 500)).toBe(true);
	});

	it("rejects zero cols", () => {
		expect(isValidDimensions(0, 24)).toBe(false);
	});

	it("rejects zero rows", () => {
		expect(isValidDimensions(80, 0)).toBe(false);
	});

	it("rejects negative values", () => {
		expect(isValidDimensions(-1, 24)).toBe(false);
		expect(isValidDimensions(80, -1)).toBe(false);
	});

	it("rejects values above 500", () => {
		expect(isValidDimensions(501, 24)).toBe(false);
		expect(isValidDimensions(80, 501)).toBe(false);
	});

	it("rejects non-integer values", () => {
		expect(isValidDimensions(80.5, 24)).toBe(false);
		expect(isValidDimensions(80, 24.5)).toBe(false);
	});

	it("rejects non-number types", () => {
		expect(isValidDimensions("80", 24)).toBe(false);
		expect(isValidDimensions(80, "24")).toBe(false);
		expect(isValidDimensions(null, 24)).toBe(false);
		expect(isValidDimensions(80, undefined)).toBe(false);
	});
});

describe("isValidInputData", () => {
	it("accepts valid Uint8Array", () => {
		expect(isValidInputData(new Uint8Array([72, 101, 108]))).toBe(true);
	});

	it("accepts empty Uint8Array", () => {
		expect(isValidInputData(new Uint8Array(0))).toBe(true);
	});

	it("accepts Uint8Array at max size", () => {
		expect(isValidInputData(new Uint8Array(MAX_INPUT_SIZE))).toBe(true);
	});

	it("rejects Uint8Array exceeding max size", () => {
		expect(isValidInputData(new Uint8Array(MAX_INPUT_SIZE + 1))).toBe(false);
	});

	it("rejects non-Uint8Array types", () => {
		expect(isValidInputData("hello")).toBe(false);
		expect(isValidInputData(Buffer.from("hello"))).toBe(true); // Buffer extends Uint8Array
		expect(isValidInputData(123)).toBe(false);
		expect(isValidInputData(null)).toBe(false);
		expect(isValidInputData(undefined)).toBe(false);
		expect(isValidInputData([1, 2, 3])).toBe(false);
	});
});

describe("isValidEnv", () => {
	it("accepts valid env object", () => {
		expect(isValidEnv({ PATH: "/usr/bin", HOME: "/home/user" })).toBe(true);
	});

	it("accepts null (optional)", () => {
		expect(isValidEnv(null)).toBe(true);
	});

	it("accepts undefined (optional)", () => {
		expect(isValidEnv(undefined)).toBe(true);
	});

	it("accepts empty object", () => {
		expect(isValidEnv({})).toBe(true);
	});

	it("rejects arrays", () => {
		expect(isValidEnv(["a", "b"])).toBe(false);
	});

	it("rejects non-object types", () => {
		expect(isValidEnv("string")).toBe(false);
		expect(isValidEnv(123)).toBe(false);
	});

	it("rejects too many entries", () => {
		const bigEnv: Record<string, string> = {};
		for (let i = 0; i <= MAX_ENV_COUNT; i++) {
			bigEnv[`KEY_${i}`] = "value";
		}
		expect(isValidEnv(bigEnv)).toBe(false);
	});

	it("accepts exactly MAX_ENV_COUNT entries", () => {
		const env: Record<string, string> = {};
		for (let i = 0; i < MAX_ENV_COUNT; i++) {
			env[`KEY_${i}`] = "value";
		}
		expect(isValidEnv(env)).toBe(true);
	});

	it("rejects non-string values", () => {
		expect(isValidEnv({ KEY: 123 })).toBe(false);
		expect(isValidEnv({ KEY: true })).toBe(false);
		expect(isValidEnv({ KEY: null })).toBe(false);
	});

	it("rejects keys longer than 256 characters", () => {
		const longKey = "K".repeat(257);
		expect(isValidEnv({ [longKey]: "value" })).toBe(false);
	});

	it("accepts keys at exactly 256 characters", () => {
		const key = "K".repeat(256);
		expect(isValidEnv({ [key]: "value" })).toBe(true);
	});

	// ── Prototype pollution keys: document accepted behavior ────────────
	// These keys look dangerous (prototype pollution vectors) but are safe here:
	// isValidEnv validates the shape of env vars passed to node-pty's spawn(),
	// which creates a new process with a fresh environment. The object is never
	// used as a prototype or merged into an existing object, so __proto__,
	// constructor, and toString keys are harmless string env var names.

	// In JS, { __proto__: "value" } sets the prototype, not an own property.
	// Object.entries() returns [] for such objects, so isValidEnv sees an empty env and returns true.
	// This is acceptable: the key never reaches child_process.
	it("accepts __proto__ as an env key (sets prototype, not own property — Object.entries is empty)", () => {
		expect(isValidEnv({ __proto__: "value" })).toBe(true);
	});

	it("accepts constructor as an env key (safe: no prototype chain manipulation)", () => {
		expect(isValidEnv({ constructor: "value" })).toBe(true);
	});

	it("accepts toString as an env key (safe: object is consumed as key-value pairs only)", () => {
		expect(isValidEnv({ toString: "value" })).toBe(true);
	});

	it("rejects values longer than 8192 characters", () => {
		const longValue = "V".repeat(8193);
		expect(isValidEnv({ KEY: longValue })).toBe(false);
	});

	it("accepts values at exactly 8192 characters", () => {
		const value = "V".repeat(8192);
		expect(isValidEnv({ KEY: value })).toBe(true);
	});
});

describe("validateCustomCommand", () => {
	// ── Valid cases ────────────────────────────────────────────────────────────

	it("accepts /usr/bin/sudo", () => {
		expect(() => validateCustomCommand("/usr/bin/sudo")).not.toThrow();
	});

	it("accepts /usr/local/bin/doas", () => {
		expect(() => validateCustomCommand("/usr/local/bin/doas")).not.toThrow();
	});

	it("accepts Windows path C:\\Windows\\System32\\gsudo.exe", () => {
		expect(() => validateCustomCommand("C:\\Windows\\System32\\gsudo.exe")).not.toThrow();
	});

	it("accepts Windows path with spaces C:\\Program Files\\gsudo\\gsudo.exe", () => {
		expect(() => validateCustomCommand("C:\\Program Files\\gsudo\\gsudo.exe")).not.toThrow();
	});

	// ── Invalid characters ─────────────────────────────────────────────────────

	it("rejects semicolon in path", () => {
		expect(() => validateCustomCommand("/usr/bin/sudo;rm -rf /")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("invalid characters") }),
		);
	});

	it("rejects pipe in path", () => {
		expect(() => validateCustomCommand("/usr/bin/sudo|cat /etc/passwd")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("invalid characters") }),
		);
	});

	it("rejects dollar sign in path", () => {
		expect(() => validateCustomCommand("/usr/bin/$sudo")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("invalid characters") }),
		);
	});

	// ── ASCII-only ─────────────────────────────────────────────────────────────

	it("rejects non-ASCII characters", () => {
		expect(() => validateCustomCommand("/usr/bin/südo")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("ASCII characters") }),
		);
	});

	// ── Absolute path ──────────────────────────────────────────────────────────

	it("rejects relative path 'sudo'", () => {
		expect(() => validateCustomCommand("sudo")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("absolute path") }),
		);
	});

	it("rejects relative path './sudo'", () => {
		expect(() => validateCustomCommand("./sudo")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("absolute path") }),
		);
	});

	// ── Path traversal ─────────────────────────────────────────────────────────

	it("rejects path traversal /usr/bin/../../../etc/shadow", () => {
		expect(() => validateCustomCommand("/usr/bin/../../../etc/shadow")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("path traversal") }),
		);
	});

	it("rejects path ending with /..", () => {
		expect(() => validateCustomCommand("/usr/bin/..")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("path traversal") }),
		);
	});

	it("rejects Windows path traversal C:\\foo\\..\\..\\Windows\\System32\\cmd.exe", () => {
		expect(() => validateCustomCommand("C:\\foo\\..\\..\\Windows\\System32\\cmd.exe")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("path traversal") }),
		);
	});

	// ── Empty / length ─────────────────────────────────────────────────────────

	it("rejects empty string", () => {
		expect(() => validateCustomCommand("")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("empty") }),
		);
	});

	it("rejects string exceeding 4096 characters", () => {
		const longPath = `/${"a".repeat(4096)}`;
		expect(() => validateCustomCommand(longPath)).toThrow(
			expect.objectContaining({ message: expect.stringContaining("maximum length") }),
		);
	});

	it("accepts string at exactly 4096 characters", () => {
		const path = `/${"a".repeat(4095)}`;
		expect(() => validateCustomCommand(path)).not.toThrow();
	});

	// ── Null bytes ─────────────────────────────────────────────────────────────

	it("rejects null bytes", () => {
		expect(() => validateCustomCommand("/usr/bin/sudo\0evil")).toThrow(
			expect.objectContaining({ message: expect.stringContaining("invalid characters") }),
		);
	});

	// ── Error code ────────────────────────────────────────────────────────────

	it("throws structured error with code INVALID_CUSTOM_COMMAND", () => {
		expect(() => validateCustomCommand("sudo")).toThrow(
			expect.objectContaining({ code: "INVALID_CUSTOM_COMMAND" }),
		);
	});
});
