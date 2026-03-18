import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";
import { openTestDatabases } from "../storage/db.js";
import type { DatabaseManager } from "../storage/db.js";
import { resetVerifyRateLimit } from "./pair.js";

// ─── Mock agents so no real PTY / SSH is spawned ─────────────────────────────

vi.mock("../session/local-agent.js", () => {
	const { EventEmitter } = require("node:events");
	class MockLocalAgent extends EventEmitter {
		connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn();
		close = vi.fn(() => {
			this.connected = false;
			this.emit("close");
		});
	}
	return { LocalAgent: MockLocalAgent };
});

vi.mock("../session/ssh-agent.js", () => {
	const { EventEmitter } = require("node:events");
	class MockSshAgent extends EventEmitter {
		connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn();
		close = vi.fn(() => {
			this.connected = false;
			this.emit("close");
		});
	}
	return { SshAgent: MockSshAgent };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_TOKEN = "test-auth-token-for-pairing-flow";

let dbs: DatabaseManager;
let server: FastifyInstance;

beforeEach(async () => {
	resetVerifyRateLimit();
	dbs = openTestDatabases();
	server = await createServer({ logger: false, dbManager: dbs, authToken: TEST_TOKEN });
});

afterEach(async () => {
	await server.close();
	dbs.close();
});

function authHeader() {
	return { authorization: `Bearer ${TEST_TOKEN}` };
}

// ─── POST /api/pair ───────────────────────────────────────────────────────────

describe("POST /api/pair", () => {
	it("generates a valid 6-digit code and returns 201", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/pair",
			headers: authHeader(),
		});
		expect(res.statusCode).toBe(201);
		const body = res.json<{ code: string; expires_at: string }>();
		expect(body.code).toMatch(/^\d{6}$/);
		expect(body.expires_at).toBeTruthy();
	});

	it("returns expires_at approximately 60 s from now", async () => {
		const before = Date.now();
		const res = await server.inject({
			method: "POST",
			url: "/api/pair",
			headers: authHeader(),
		});
		const after = Date.now();

		const body = res.json<{ expires_at: string }>();
		const expiresMs = new Date(body.expires_at).getTime();

		// Should be within [before + 59s, after + 61s]
		expect(expiresMs).toBeGreaterThanOrEqual(before + 59_000);
		expect(expiresMs).toBeLessThanOrEqual(after + 61_000);
	});

	it("returns 401 without auth", async () => {
		const res = await server.inject({ method: "POST", url: "/api/pair" });
		expect(res.statusCode).toBe(401);
	});

	it("returns 429 when 3 active codes already exist", async () => {
		// Create 3 codes
		for (let i = 0; i < 3; i++) {
			const r = await server.inject({
				method: "POST",
				url: "/api/pair",
				headers: authHeader(),
			});
			expect(r.statusCode).toBe(201);
		}

		// 4th should be rate-limited
		const res = await server.inject({
			method: "POST",
			url: "/api/pair",
			headers: authHeader(),
		});
		expect(res.statusCode).toBe(429);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("RATE_LIMIT");
	});
});

// ─── POST /api/pair/verify ────────────────────────────────────────────────────

describe("POST /api/pair/verify", () => {
	it("returns the auth token for a valid code", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/pair",
			headers: authHeader(),
		});
		const { code } = createRes.json<{ code: string }>();

		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ token: string }>();
		expect(body.token).toBe(TEST_TOKEN);
	});

	it("requires no auth header (unauthenticated endpoint)", async () => {
		// Just verifying that verify works without Bearer token
		const createRes = await server.inject({
			method: "POST",
			url: "/api/pair",
			headers: authHeader(),
		});
		const { code } = createRes.json<{ code: string }>();

		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			// No auth header
			payload: { code },
		});
		expect(res.statusCode).toBe(200);
	});

	it("returns 400 for non-string code", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code: 123456 },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_FORMAT");
	});

	it("returns 400 for code with wrong length", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code: "12345" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_FORMAT");
	});

	it("returns 400 for code with non-digit characters", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code: "12345a" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_FORMAT");
	});

	it("returns 404 for unknown code", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code: "000000" },
		});
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("CODE_NOT_FOUND");
	});

	it("returns 409 for already-used code", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/pair",
			headers: authHeader(),
		});
		const { code } = createRes.json<{ code: string }>();

		// First verify — succeeds
		await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code },
		});

		// Second verify — conflict
		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code },
		});
		expect(res.statusCode).toBe(409);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("CODE_USED");
	});

	it("returns 410 for an expired code", async () => {
		const { MetaDAL } = await import("../storage/meta.js");
		const dal = new MetaDAL(dbs.meta);

		// Insert a code that expired 1 second ago
		const pastExpiry = new Date(Date.now() - 1000).toISOString();
		dal.createPairingCode(
			"EXPIRED01AAAAAAAAAAAAAAAAAAA",
			"777777",
			new Date().toISOString(),
			pastExpiry,
		);

		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code: "777777" },
		});
		expect(res.statusCode).toBe(410);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("CODE_EXPIRED");
	});

	it("returns 429 after 10 verify attempts within 60 s", async () => {
		// Exhaust the 10-attempt budget with unknown codes (fast, no DB setup needed)
		for (let i = 0; i < 10; i++) {
			const r = await server.inject({
				method: "POST",
				url: "/api/pair/verify",
				payload: { code: "000000" },
			});
			// All return 404, but that's fine — counter still increments
			expect(r.statusCode).toBe(404);
		}

		// 11th attempt → rate limited
		const res = await server.inject({
			method: "POST",
			url: "/api/pair/verify",
			payload: { code: "000000" },
		});
		expect(res.statusCode).toBe(429);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("RATE_LIMIT");
	});
});
