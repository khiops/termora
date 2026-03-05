import { describe, expect, it } from "vitest";
import {
	MAX_ENV_COUNT,
	MAX_INPUT_SIZE,
	isValidDimensions,
	isValidEnv,
	isValidInputData,
	isValidUlid,
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

	it("rejects values longer than 8192 characters", () => {
		const longValue = "V".repeat(8193);
		expect(isValidEnv({ KEY: longValue })).toBe(false);
	});

	it("accepts values at exactly 8192 characters", () => {
		const value = "V".repeat(8192);
		expect(isValidEnv({ KEY: value })).toBe(true);
	});
});
