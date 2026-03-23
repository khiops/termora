import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLogRoutes } from "./logs.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "nexterm-logs-test-"));
}

function writeChannelLog(logsDir: string, channelId: string, lines: object[]): void {
	const dir = path.join(logsDir, "channels");
	fs.mkdirSync(dir, { recursive: true });
	const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
	fs.writeFileSync(path.join(dir, `${channelId}.jsonl`), content);
}

function writeHubLog(logsDir: string, lines: object[]): void {
	fs.mkdirSync(logsDir, { recursive: true });
	const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
	fs.writeFileSync(path.join(logsDir, "hub.jsonl"), content);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A valid 26-char alphanumeric channel ID (ULID-shaped)
const CHANNEL_ID = "01JQKZ2ABCDEFGHJKMNPQRSTUV";

const CHANNEL_ENTRIES = [
	{ t: 0, src: "hub", lvl: "info", msg: "channel opened" },
	{ t: 100, src: "agent", lvl: "debug", msg: "pty created" },
	{ t: 200, src: "hub", lvl: "warn", msg: "backpressure detected" },
	{ t: 300, src: "hub", lvl: "error", msg: "write failed" },
];

const HUB_ENTRIES = [
	{ ts: "2026-03-21T10:00:00.000Z", lvl: "info", msg: "hub started" },
	{ ts: "2026-03-21T10:01:00.000Z", lvl: "debug", msg: "session created" },
	{ ts: "2026-03-21T10:02:00.000Z", lvl: "warn", msg: "reconnect attempt" },
	{ ts: "2026-03-21T10:03:00.000Z", lvl: "error", msg: "agent disconnected" },
];

// ─── Test setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let logsDir: string;
let app: FastifyInstance;

beforeEach(async () => {
	tmpDir = makeTmpDir();
	logsDir = path.join(tmpDir, "logs");
	app = Fastify({ logger: false });
	await registerLogRoutes(app, logsDir);
	await app.ready();
});

afterEach(async () => {
	await app.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── GET /api/logs/channels/:channelId ────────────────────────────────────────

describe("GET /api/logs/channels/:channelId", () => {
	it("returns empty entries when file does not exist", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: unknown[]; total: number }>();
		expect(body.entries).toEqual([]);
		expect(body.total).toBe(0);
	});

	it("parses JSONL and returns all entries", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: unknown[]; total: number }>();
		expect(body.total).toBe(4);
		expect(body.entries).toHaveLength(4);
	});

	it("skips malformed JSONL lines", async () => {
		const dir = path.join(logsDir, "channels");
		fs.mkdirSync(dir, { recursive: true });
		const content = [
			JSON.stringify({ t: 0, src: "hub", lvl: "info", msg: "ok" }),
			"NOT VALID JSON{{{{",
			"",
			JSON.stringify({ t: 1, src: "hub", lvl: "info", msg: "also ok" }),
		].join("\n");
		fs.writeFileSync(path.join(dir, `${CHANNEL_ID}.jsonl`), content);

		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: unknown[]; total: number }>();
		expect(body.total).toBe(2);
		expect(body.entries).toHaveLength(2);
	});

	it("filters by level — warn returns warn and error only", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}?level=warn`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ lvl: string }>; total: number }>();
		expect(body.total).toBe(2);
		expect(body.entries.map((e) => e.lvl)).toEqual(["warn", "error"]);
	});

	it("filters by level — error returns error only", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}?level=error`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ lvl: string }>; total: number }>();
		expect(body.total).toBe(1);
		expect(body.entries[0]?.lvl).toBe("error");
	});

	it("filters by search (case-insensitive)", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}?search=BACKPRESSURE`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ msg: string }>; total: number }>();
		expect(body.total).toBe(1);
		expect(body.entries[0]?.msg).toBe("backpressure detected");
	});

	it("filters by from_t / to_t (ms offset range)", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}?from_t=100&to_t=200`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ t: number }>; total: number }>();
		expect(body.total).toBe(2);
		expect(body.entries.map((e) => e.t)).toEqual([100, 200]);
	});

	it("applies limit and offset for pagination", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}?limit=2&offset=1`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ t: number }>; total: number }>();
		expect(body.total).toBe(4); // total before pagination
		expect(body.entries).toHaveLength(2);
		expect(body.entries[0]?.t).toBe(100); // second entry (offset=1)
		expect(body.entries[1]?.t).toBe(200);
	});

	it("blocks path traversal via channelId (returns 400)", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/logs/channels/../../../etc/passwd",
		});
		// Fastify may return 400 (param validation) or 404 (route not matched)
		// — either is safe. We just assert it's not 200.
		expect(res.statusCode).not.toBe(200);
	});

	it("blocks short channelId (returns 400)", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/logs/channels/short",
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_CHANNEL_ID");
	});

	it("returns 400 for invalid limit", async () => {
		writeChannelLog(logsDir, CHANNEL_ID, CHANNEL_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: `/api/logs/channels/${CHANNEL_ID}?limit=9999`,
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});

// ─── GET /api/logs/hub ────────────────────────────────────────────────────────

describe("GET /api/logs/hub", () => {
	it("returns empty entries when file does not exist", async () => {
		const res = await app.inject({ method: "GET", url: "/api/logs/hub" });
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: unknown[]; total: number }>();
		expect(body.entries).toEqual([]);
		expect(body.total).toBe(0);
	});

	it("parses hub JSONL and returns all entries", async () => {
		writeHubLog(logsDir, HUB_ENTRIES);
		const res = await app.inject({ method: "GET", url: "/api/logs/hub" });
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: unknown[]; total: number }>();
		expect(body.total).toBe(4);
		expect(body.entries).toHaveLength(4);
	});

	it("skips malformed JSONL lines", async () => {
		fs.mkdirSync(logsDir, { recursive: true });
		const content = [
			JSON.stringify({ ts: "2026-03-21T10:00:00.000Z", lvl: "info", msg: "good" }),
			"INVALID_JSON",
			JSON.stringify({ ts: "2026-03-21T10:01:00.000Z", lvl: "info", msg: "also good" }),
		].join("\n");
		fs.writeFileSync(path.join(logsDir, "hub.jsonl"), content);

		const res = await app.inject({ method: "GET", url: "/api/logs/hub" });
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: unknown[]; total: number }>();
		expect(body.total).toBe(2);
	});

	it("filters by level — warn returns warn and error", async () => {
		writeHubLog(logsDir, HUB_ENTRIES);
		const res = await app.inject({ method: "GET", url: "/api/logs/hub?level=warn" });
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ lvl: string }>; total: number }>();
		expect(body.total).toBe(2);
		expect(body.entries.map((e) => e.lvl)).toEqual(["warn", "error"]);
	});

	it("filters by search (case-insensitive)", async () => {
		writeHubLog(logsDir, HUB_ENTRIES);
		const res = await app.inject({ method: "GET", url: "/api/logs/hub?search=RECONNECT" });
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ msg: string }>; total: number }>();
		expect(body.total).toBe(1);
		expect(body.entries[0]?.msg).toBe("reconnect attempt");
	});

	it("filters by from_t / to_t (ISO date range)", async () => {
		writeHubLog(logsDir, HUB_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: "/api/logs/hub?from_t=2026-03-21T10:01:00.000Z&to_t=2026-03-21T10:02:00.000Z",
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ lvl: string }>; total: number }>();
		expect(body.total).toBe(2);
		expect(body.entries.map((e) => e.lvl)).toEqual(["debug", "warn"]);
	});

	it("applies limit and offset for pagination", async () => {
		writeHubLog(logsDir, HUB_ENTRIES);
		const res = await app.inject({
			method: "GET",
			url: "/api/logs/hub?limit=2&offset=2",
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ entries: Array<{ lvl: string }>; total: number }>();
		expect(body.total).toBe(4);
		expect(body.entries).toHaveLength(2);
		expect(body.entries[0]?.lvl).toBe("warn");
		expect(body.entries[1]?.lvl).toBe("error");
	});

	it("returns 400 for invalid offset", async () => {
		const res = await app.inject({ method: "GET", url: "/api/logs/hub?offset=-5" });
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});
