import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

describe("Hub Server", () => {
	let server: FastifyInstance;

	afterEach(async () => {
		if (server) await server.close();
	});

	it("should create a server instance", async () => {
		server = await createServer({ logger: false });
		expect(server).toBeDefined();
	});

	it("GET /health returns ok status", async () => {
		server = await createServer({ logger: false });
		const response = await server.inject({ method: "GET", url: "/health" });
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
