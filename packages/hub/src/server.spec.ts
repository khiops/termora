import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

/** Known token used across auth tests */
const TEST_TOKEN = "a".repeat(64);

describe("Hub Server", () => {
	let server: FastifyInstance;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("should create a server instance", async () => {
		server = await createServer({ logger: false });
		expect(server).toBeDefined();
	});

	it("GET /api/health returns ok status", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({ method: "GET", url: "/api/health" });
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.status).toBe("ok");
		expect(body.version).toBe("0.1.0");
		expect(typeof body.uptime).toBe("number");
	});

	it("GET /unknown returns 404", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({ method: "GET", url: "/unknown" });
		expect(response.statusCode).toBe(404);
	});
});

describe("Hub Server — Bearer auth", () => {
	let server: FastifyInstance;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("GET /api/health is accessible without token", async () => {
		server = await createServer({ logger: false, authToken: TEST_TOKEN });
		const response = await server.inject({ method: "GET", url: "/api/health" });
		expect(response.statusCode).toBe(200);
	});

	it("GET /api/pair/verify is accessible without token", async () => {
		server = await createServer({ logger: false, authToken: TEST_TOKEN });
		// Route doesn't exist yet (M4.2) — but auth must not block it; expect 404 not 401
		const response = await server.inject({ method: "GET", url: "/api/pair/verify" });
		expect(response.statusCode).not.toBe(401);
	});

	it("API route without Authorization header → 401 AUTH_REQUIRED", async () => {
		server = await createServer({ logger: false, authToken: TEST_TOKEN });
		const response = await server.inject({ method: "GET", url: "/api/unknown" });
		expect(response.statusCode).toBe(401);
		const body = response.json();
		expect(body.error).toBe("AUTH_REQUIRED");
	});

	it("API route with wrong token → 401 AUTH_INVALID", async () => {
		server = await createServer({ logger: false, authToken: TEST_TOKEN });
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
		server = await createServer({ logger: false, authToken: TEST_TOKEN });
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
		server = await createServer({ logger: false, authToken: TEST_TOKEN });
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
