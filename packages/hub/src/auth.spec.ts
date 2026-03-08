import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { checkPermissions, initAuth, validateToken } from "./auth.js";

describe("initAuth", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `nexterm-auth-test-${randomBytes(8).toString("hex")}`);
	});

	it("generates a 64-hex-char token on first call", () => {
		const token = initAuth(testDir);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("writes auth.json with the generated token", () => {
		const token = initAuth(testDir);
		const authFile = join(testDir, "auth.json");
		expect(existsSync(authFile)).toBe(true);
		const parsed = JSON.parse(readFileSync(authFile, "utf-8")) as { token: string };
		expect(parsed.token).toBe(token);
	});

	it("reads the existing token on second call (no regeneration)", () => {
		const token1 = initAuth(testDir);
		const token2 = initAuth(testDir);
		expect(token1).toBe(token2);
	});

	it("sets chmod 600 on auth.json (non-Windows)", () => {
		if (process.platform === "win32") return;
		initAuth(testDir);
		const authFile = join(testDir, "auth.json");
		const mode = statSync(authFile).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe("validateToken", () => {
	it("returns true for matching tokens", () => {
		const token = randomBytes(32).toString("hex");
		expect(validateToken(token, token)).toBe(true);
	});

	it("returns false for wrong token", () => {
		const expected = randomBytes(32).toString("hex");
		const provided = randomBytes(32).toString("hex");
		// Extremely unlikely to collide, but skip if they do
		if (provided === expected) return;
		expect(validateToken(provided, expected)).toBe(false);
	});

	it("returns false for different-length token (no crash)", () => {
		expect(validateToken("short", "a".repeat(64))).toBe(false);
		expect(validateToken("a".repeat(64), "short")).toBe(false);
		expect(validateToken("", "token")).toBe(false);
	});
});

describe("checkPermissions", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `nexterm-perm-test-${randomBytes(8).toString("hex")}`);
	});

	it("throws if auth.json is world-readable (non-Windows)", () => {
		if (process.platform === "win32") return;

		// Create a real file with world-readable permissions
		const { mkdirSync } = require("node:fs") as typeof import("node:fs");
		mkdirSync(testDir, { recursive: true });
		const authFile = join(testDir, "auth.json");
		writeFileSync(authFile, JSON.stringify({ token: "test" }));
		chmodSync(authFile, 0o604); // world-readable

		expect(() => checkPermissions(authFile)).toThrow(/world-readable/);
	});

	it("does not throw for mode 0o600 (non-Windows)", () => {
		if (process.platform === "win32") return;

		const { mkdirSync } = require("node:fs") as typeof import("node:fs");
		mkdirSync(testDir, { recursive: true });
		const authFile = join(testDir, "auth.json");
		writeFileSync(authFile, JSON.stringify({ token: "test" }));
		chmodSync(authFile, 0o600);

		expect(() => checkPermissions(authFile)).not.toThrow();
	});
});
