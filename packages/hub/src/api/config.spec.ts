import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerConfigRoutes } from "../api/config.js";
import { ConfigResolver } from "../config.js";
import { createServer } from "../server.js";
import { openTestDatabases } from "../storage/db.js";
import type { DatabaseManager } from "../storage/db.js";
import { MetaDAL } from "../storage/meta.js";

vi.mock("ssh2", () => ({
	Client: vi.fn().mockImplementation(() => ({
		connect: vi.fn(),
		end: vi.fn(),
		destroy: vi.fn(),
		on: vi.fn().mockReturnThis(),
	})),
}));

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

let dbs: DatabaseManager;
let server: FastifyInstance;

beforeEach(async () => {
	dbs = openTestDatabases();
	server = await createServer({ logger: false, dbManager: dbs });
});

afterEach(async () => {
	await server.close();
	dbs.close();
});

// ─── PUT /api/config/ui — value type validation ───────────────────────────────

describe("PUT /api/config/ui value validation", () => {
	it("accepts valid boolean for closeButton", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { tabs: { closeButton: true } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects non-boolean for closeButton", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { tabs: { closeButton: "yes" } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid newTabPosition value", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { tabs: { newTabPosition: "afterActive" } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects invalid newTabPosition value", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { tabs: { newTabPosition: "first" } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid maxPanes integer", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { panes: { maxPanes: 4 } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects maxPanes < 1", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { panes: { maxPanes: 0 } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("rejects non-integer maxPanes", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { panes: { maxPanes: 2.5 } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid defaultSplitDirection", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { panes: { defaultSplitDirection: "vertical" } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects invalid defaultSplitDirection", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { panes: { defaultSplitDirection: "diagonal" } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid autoGroup value", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { channels: { autoGroup: "first" } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects invalid autoGroup value", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { channels: { autoGroup: "last" } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid historySize (0-100)", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { search: { historySize: 50 } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects historySize > 100", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { search: { historySize: 101 } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid search position", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { search: { position: "bottom-bar" } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects invalid search position", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { search: { position: "top-left" } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("accepts valid layout widths", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { layout: { hostRailWidth: 48, sidebarWidth: 200 } },
		});
		expect(res.statusCode).toBe(200);
	});

	it("rejects negative layout width", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { layout: { sidebarWidth: -1 } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("INVALID_VALUE");
	});

	it("still rejects unknown keys (existing behaviour)", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { tabs: { unknownKey: true } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("still rejects unknown sections (existing behaviour)", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { bogusSection: { foo: 1 } },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});

// ─── broadcastDisplayTitles: called on PUT /api/config/ui with title section ──

describe("PUT /api/config/ui — broadcastDisplayTitles integration", () => {
	let miniServer: FastifyInstance;
	let testDbs: ReturnType<typeof openTestDatabases>;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `nexterm-bdt-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		testDbs = openTestDatabases();
		miniServer = Fastify({ logger: false });
	});

	afterEach(async () => {
		await miniServer.close();
		testDbs.close();
	});

	it("calls sessionManager.broadcastDisplayTitles() when title section is in body", async () => {
		const called: boolean[] = [];
		const mockSessionManager = {
			broadcastDisplayTitles: () => {
				called.push(true);
			},
		};

		const metaDal = new MetaDAL(testDbs.meta);
		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(tempDir);
		registerConfigRoutes(miniServer, metaDal, resolver, mockSessionManager);

		const res = await miniServer.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { title: { source: "static", staticTitle: "My Tab" } },
		});

		expect(res.statusCode).toBe(200);
		expect(called.length).toBeGreaterThan(0);
	});

	it("does NOT call broadcastDisplayTitles() when title section is absent", async () => {
		const called: boolean[] = [];
		const mockSessionManager = {
			broadcastDisplayTitles: () => {
				called.push(true);
			},
		};

		const metaDal = new MetaDAL(testDbs.meta);
		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(tempDir);
		registerConfigRoutes(miniServer, metaDal, resolver, mockSessionManager);

		const res = await miniServer.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { tabs: { closeButton: false } },
		});

		expect(res.statusCode).toBe(200);
		expect(called.length).toBe(0);
	});

	it("does NOT call broadcastDisplayTitles() when no sessionManager provided", async () => {
		// Regression guard: omitting sessionManager (old call-site) must not throw
		const metaDal = new MetaDAL(testDbs.meta);
		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(tempDir);
		registerConfigRoutes(miniServer, metaDal, resolver); // no sessionManager

		const res = await miniServer.inject({
			method: "PUT",
			url: "/api/config/ui",
			payload: { title: { source: "dynamic" } },
		});

		expect(res.statusCode).toBe(200);
	});
});
