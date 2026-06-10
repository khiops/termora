import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCorsOrigins, createServer } from "./server.js";
import type { DatabaseManager } from "./storage/db.js";
import { openTestDatabases } from "./storage/db.js";

/** Known token used across auth tests */
const TEST_TOKEN = "a".repeat(64);
const TTF_MAGIC = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

describe("Hub Server", () => {
	let server: FastifyInstance;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("should create a server instance", async () => {
		server = await createServer({ logger: false });
		expect(server).toBeDefined();
	});

	it("GET /api/health returns ok status with build hash and version", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({ method: "GET", url: "/api/health" });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.status).toBe("ok");
		expect(typeof body.version).toBe("string");
		expect(body.version.length).toBeGreaterThan(0);
		expect(typeof body.build).toBe("string");
		expect(body.build.length).toBeGreaterThan(0);
		expect(body.uptime).toBeUndefined();
	});

	it("GET /unknown returns 404", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({ method: "GET", url: "/unknown" });
		expect(response.statusCode).toBe(404);
	});
});

describe("Hub Server — Bearer auth", () => {
	let server: FastifyInstance;
	let dbs: DatabaseManager;

	beforeEach(() => {
		dbs = openTestDatabases();
	});

	afterEach(async () => {
		if (server) await server.close();
		dbs.meta.close();
		dbs.spool.close();
	});

	it("GET /api/health is accessible without token", async () => {
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});
		const response = await server.inject({ method: "GET", url: "/api/health" });
		expect(response.statusCode).toBe(200);
	});

	it("GET /api/pair/verify is accessible without token", async () => {
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});
		// Route doesn't exist yet (M4.2) — but auth must not block it; expect 404 not 401
		const response = await server.inject({ method: "GET", url: "/api/pair/verify" });
		expect(response.statusCode).not.toBe(401);
	});

	it("API route without Authorization header → 401 AUTH_REQUIRED", async () => {
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});
		const response = await server.inject({ method: "GET", url: "/api/unknown" });
		expect(response.statusCode).toBe(401);
		const body = response.json();
		expect(body.error).toBe("AUTH_REQUIRED");
	});

	it("API route with wrong token → 401 AUTH_INVALID", async () => {
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});
		const response = await server.inject({
			method: "GET",
			url: "/api/unknown",
			headers: { authorization: `Bearer ${"b".repeat(64)}` },
		});
		expect(response.statusCode).toBe(401);
		const body = response.json();
		expect(body.error).toBe("AUTH_INVALID");
	});

	it("API route with malformed Authorization header → 401", async () => {
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});
		const response = await server.inject({
			method: "GET",
			url: "/api/unknown",
			headers: { authorization: "Token abc123" },
		});
		expect(response.statusCode).toBe(401);
		const body = response.json();
		expect(body.error).toBe("AUTH_REQUIRED");
	});

	it("API route with correct token → passes auth (404 from missing route, not 401)", async () => {
		server = await createServer({
			logger: false,
			authToken: TEST_TOKEN,
			dbManager: dbs,
			skipShellDiscovery: true,
		});
		const response = await server.inject({
			method: "GET",
			url: "/api/unknown",
			headers: { authorization: `Bearer ${TEST_TOKEN}` },
		});
		expect(response.statusCode).toBe(404);
	});

	it("no authToken configured → all routes accessible without auth", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({ method: "GET", url: "/unknown" });
		// Without auth, falls through to 404 — not 401
		expect(response.statusCode).toBe(404);
	});
});

describe("Hub Server — CORS allowlist", () => {
	let server: FastifyInstance;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("allowed origin (localhost:5173) gets Access-Control-Allow-Origin header when explicitly allowed", async () => {
		// SEC-020: localhost:5173 is NOT in the default allowlist — it must be explicitly added
		// (done in main.ts after startServer() in non-production, or via corsOrigins override).
		server = await createServer({ logger: false, corsOrigins: ["http://localhost:5173"] });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://localhost:5173" },
		});
		expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
	});

	it("disallowed origin (http://evil.com) gets no CORS allow header", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://evil.com" },
		});
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("subdomain bypass blocked (http://localhost.evil.com:5173)", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://localhost.evil.com:5173" },
		});
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("default config allows Tauri origin (tauri://localhost)", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "tauri://localhost" },
		});
		expect(response.headers["access-control-allow-origin"]).toBe("tauri://localhost");
	});

	it("default config allows http://tauri.localhost", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://tauri.localhost" },
		});
		expect(response.headers["access-control-allow-origin"]).toBe("http://tauri.localhost");
	});

	it("empty allowlist rejects all origins", async () => {
		server = await createServer({ logger: false, corsOrigins: [] });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://localhost:5173" },
		});
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("missing origin header results in no CORS allow header", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
		});
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("127.0.0.1 origin is allowed after addCorsOrigins() injects the actual port", async () => {
		// SEC-020: Exact localhost origins are not in defaults — addCorsOrigins() injects them
		// after startServer() returns the actual port (done in main.ts).
		server = await createServer({ logger: false });
		addCorsOrigins("http://127.0.0.1:4100");
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://127.0.0.1:4100" },
		});
		expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4100");
	});

	it("localhost:5173 is NOT allowed by default (no wildcard)", async () => {
		// SEC-020: Verify wildcard removal — localhost:5173 must not be allowed without explicit config.
		server = await createServer({ logger: false, corsOrigins: [] });
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://localhost:5173" },
		});
		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("addCorsOrigins() adds an exact origin to the allowlist", async () => {
		server = await createServer({ logger: false, corsOrigins: [] });
		addCorsOrigins("http://localhost:9999");
		const response = await server.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://localhost:9999" },
		});
		expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:9999");
	});
});

describe("Hub Server — security headers", () => {
	let server: FastifyInstance | undefined;
	let dbs: DatabaseManager | undefined;
	let configDir: string | undefined;

	afterEach(async () => {
		if (server) await server.close();
		dbs?.close();
		if (configDir) rmSync(configDir, { recursive: true, force: true });
		server = undefined;
		dbs = undefined;
		configDir = undefined;
	});

	it("GET /public/fonts/:file serves public assets with cross-origin CORP", async () => {
		configDir = join(
			tmpdir(),
			`termora-public-corp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(join(configDir, "fonts"), { recursive: true });
		writeFileSync(join(configDir, "fonts", "Test-Regular.ttf"), TTF_MAGIC);
		dbs = openTestDatabases();
		server = await createServer({
			logger: false,
			dbManager: dbs,
			skipShellDiscovery: true,
			configDir,
		});

		const response = await server.inject({
			method: "GET",
			url: "/public/fonts/Test-Regular.ttf",
			headers: { origin: "tauri://localhost" },
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
	});

	it("GET /api/health keeps Helmet's same-origin CORP", async () => {
		server = await createServer({ logger: false });

		const response = await server.inject({ method: "GET", url: "/api/health" });

		expect(response.statusCode).toBe(200);
		expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
	});
});
