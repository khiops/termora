import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LogConfig } from "@nexterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HubLogger } from "./hub-logger.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "nexterm-hub-logger-"));
}

function makeConfig(overrides: Partial<LogConfig> = {}): LogConfig {
	return {
		level: "info",
		output: "file",
		maxAgeDays: 30,
		maxSizeMb: 50,
		...overrides,
	};
}

function readLines(filePath: string): Record<string, unknown>[] {
	const raw = fs.readFileSync(filePath, "utf8");
	return raw
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HubLogger", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes JSONL with ISO 8601 ts field", () => {
		const logger = new HubLogger(tmpDir, makeConfig());
		logger.log("info", "hub started");

		const filePath = path.join(tmpDir, "hub.jsonl");
		expect(fs.existsSync(filePath)).toBe(true);

		const lines = readLines(filePath);
		expect(lines).toHaveLength(1);
		const entry = lines[0]!;
		expect(entry["lvl"]).toBe("info");
		expect(entry["msg"]).toBe("hub started");
		// ts is ISO 8601
		expect(typeof entry["ts"]).toBe("string");
		expect(() => new Date(entry["ts"] as string)).not.toThrow();
		expect(new Date(entry["ts"] as string).toISOString()).toBe(entry["ts"]);
	});

	it("filters out entries below configured level", () => {
		const logger = new HubLogger(tmpDir, makeConfig({ level: "warn" }));
		logger.log("debug", "filtered");
		logger.log("info", "also filtered");
		logger.log("warn", "visible");
		logger.log("error", "also visible");

		const filePath = path.join(tmpDir, "hub.jsonl");
		const lines = readLines(filePath);
		expect(lines).toHaveLength(2);
		expect(lines[0]!["lvl"]).toBe("warn");
		expect(lines[1]!["lvl"]).toBe("error");
	});

	it("rotates to hub.jsonl.old when size exceeds 10 MB", () => {
		const logger = new HubLogger(tmpDir, makeConfig());
		const filePath = path.join(tmpDir, "hub.jsonl");
		const oldPath = path.join(tmpDir, "hub.jsonl.old");

		// Pre-seed file to just over 10 MB
		const tenMbPlusOne = 10 * 1024 * 1024 + 1;
		fs.writeFileSync(filePath, Buffer.alloc(tenMbPlusOne, "x"), { mode: 0o600 });

		logger.log("info", "triggers rotation");

		// Original file should now be hub.jsonl.old (or have been replaced)
		expect(fs.existsSync(oldPath)).toBe(true);
		// New hub.jsonl should exist and be small
		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.statSync(filePath).size).toBeLessThan(tenMbPlusOne);
	});

	it("spreads extra fields into the entry", () => {
		const logger = new HubLogger(tmpDir, makeConfig());
		logger.log("error", "crash", { code: 500, component: "ws" });

		const filePath = path.join(tmpDir, "hub.jsonl");
		const lines = readLines(filePath);
		expect(lines[0]!["code"]).toBe(500);
		expect(lines[0]!["component"]).toBe("ws");
	});

	it("creates logsDir on first write if missing", () => {
		const subDir = path.join(tmpDir, "nested", "logs");
		expect(fs.existsSync(subDir)).toBe(false);

		const logger = new HubLogger(subDir, makeConfig());
		logger.log("info", "init");

		expect(fs.existsSync(path.join(subDir, "hub.jsonl"))).toBe(true);
	});
});
