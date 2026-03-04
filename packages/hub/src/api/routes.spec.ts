import type { ProtocolMessage } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";
import { openTestDatabases } from "../storage/db.js";
import type { DatabaseManager } from "../storage/db.js";

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

// ─── Hosts ────────────────────────────────────────────────────────────────────

describe("GET /api/hosts", () => {
	it("returns at least the built-in local host", async () => {
		const res = await server.inject({ method: "GET", url: "/api/hosts" });
		expect(res.statusCode).toBe(200);
		const body = res.json<unknown[]>();
		expect(Array.isArray(body)).toBe(true);
		// ensureLocalHost creates a 'local' host on startup
		expect(body.length).toBeGreaterThanOrEqual(1);
	});
});

describe("POST /api/hosts", () => {
	it("creates a local host and returns 201", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "my-local" },
		});
		expect(res.statusCode).toBe(201);
		const body = res.json<Record<string, unknown>>();
		expect(body.type).toBe("local");
		expect(body.label).toBe("my-local");
		expect(body.id).toBeTruthy();
		expect(body.created_at).toBeTruthy();
	});

	it("creates an SSH host with all fields and returns 201", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: {
				type: "ssh",
				label: "prod-server",
				ssh_host: "192.168.1.100",
				ssh_port: 2222,
				ssh_auth: "key",
				ssh_key_path: "/home/user/.ssh/id_ed25519",
				color: "#ff0000",
				trust_remote_hints: "ask",
			},
		});
		expect(res.statusCode).toBe(201);
		const body = res.json<Record<string, unknown>>();
		expect(body.type).toBe("ssh");
		expect(body.label).toBe("prod-server");
		expect(body.ssh_host).toBe("192.168.1.100");
		expect(body.ssh_port).toBe(2222);
		expect(body.ssh_auth).toBe("key");
		expect(body.ssh_key_path).toBe("/home/user/.ssh/id_ed25519");
		expect(body.color).toBe("#ff0000");
		expect(body.trust_remote_hints).toBe("ask");
	});

	it("returns 400 when label is missing", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 400 when SSH host is missing ssh_host", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "ssh", label: "ssh-no-host" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 400 for invalid color format", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "color-bad", color: "notacolor" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 409 when label already exists", async () => {
		await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "duplicate-label" },
		});
		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "duplicate-label" },
		});
		expect(res.statusCode).toBe(409);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("CONFLICT");
	});
});

describe("GET /api/hosts/:id", () => {
	it("returns the host", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "get-test" },
		});
		const created = createRes.json<Record<string, unknown>>();

		const res = await server.inject({
			method: "GET",
			url: `/api/hosts/${created.id}`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		expect(body.id).toBe(created.id);
		expect(body.label).toBe("get-test");
	});

	it("returns 404 for unknown id", async () => {
		const res = await server.inject({ method: "GET", url: "/api/hosts/nonexistent" });
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("NOT_FOUND");
	});
});

describe("PUT /api/hosts/:id", () => {
	it("updates host fields", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "update-me" },
		});
		const created = createRes.json<Record<string, unknown>>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/hosts/${created.id}`,
			payload: { label: "updated-label", color: "#00ff00" },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		expect(body.label).toBe("updated-label");
		expect(body.color).toBe("#00ff00");
	});

	it("returns 404 for unknown id", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/hosts/nonexistent",
			payload: { label: "x" },
		});
		expect(res.statusCode).toBe(404);
	});
});

describe("DELETE /api/hosts/:id", () => {
	it("deletes a host and returns 204", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "delete-me" },
		});
		const created = createRes.json<Record<string, unknown>>();

		const res = await server.inject({
			method: "DELETE",
			url: `/api/hosts/${created.id}`,
		});
		expect(res.statusCode).toBe(204);

		const getRes = await server.inject({
			method: "GET",
			url: `/api/hosts/${created.id}`,
		});
		expect(getRes.statusCode).toBe(404);
	});

	it("returns 404 for unknown id", async () => {
		const res = await server.inject({ method: "DELETE", url: "/api/hosts/nonexistent" });
		expect(res.statusCode).toBe(404);
	});
});

describe("POST /api/hosts/:id/test", () => {
	it("returns ok:true for a local host", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "test-connectivity" },
		});
		const created = createRes.json<Record<string, unknown>>();

		const res = await server.inject({
			method: "POST",
			url: `/api/hosts/${created.id}/test`,
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<{ ok: boolean }>();
		expect(body.ok).toBe(true);
	});

	it("returns 404 for unknown host id", async () => {
		const res = await server.inject({ method: "POST", url: "/api/hosts/nonexistent/test" });
		expect(res.statusCode).toBe(404);
	});
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

describe("GET /api/sessions", () => {
	it("returns an array (initially only sessions from ensureLocalHost flow)", async () => {
		const res = await server.inject({ method: "GET", url: "/api/sessions" });
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(res.json())).toBe(true);
	});

	it("filters by host_id", async () => {
		const hostsRes = await server.inject({ method: "GET", url: "/api/hosts" });
		const hosts = hostsRes.json<Array<{ id: string }>>();
		const localHost = hosts[0];

		const res = await server.inject({
			method: "GET",
			url: `/api/sessions?host_id=${localHost?.id ?? "x"}`,
		});
		expect(res.statusCode).toBe(200);
		const sessions = res.json<Array<{ host_id: string }>>();
		for (const s of sessions) {
			expect(s.host_id).toBe(localHost?.id);
		}
	});
});

describe("GET /api/sessions/:id", () => {
	it("returns 404 for unknown session id", async () => {
		const res = await server.inject({ method: "GET", url: "/api/sessions/nonexistent" });
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("NOT_FOUND");
	});

	it("returns session with embedded channels array", async () => {
		// Create a host so we can seed a session via metaDal directly
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "session-get-test" },
		});
		const host = createRes.json<{ id: string }>();

		// Inject a session via the list endpoint path — use MetaDAL directly
		// via the server's sessionManager (accessible via the test db)
		const { MetaDAL } = await import("../storage/meta.js");
		const dal = new MetaDAL(dbs.meta);
		const sessionId = "01TESTSESSION0000000000001";
		dal.createSession({ id: sessionId, hostId: host.id, status: "active" });

		const res = await server.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
		expect(res.statusCode).toBe(200);
		const body = res.json<{ id: string; status: string; channels: unknown[] }>();
		expect(body.id).toBe(sessionId);
		expect(body.status).toBe("active");
		expect(Array.isArray(body.channels)).toBe(true);
	});
});

describe("DELETE /api/sessions/:id", () => {
	it("returns 404 for unknown session id", async () => {
		const res = await server.inject({ method: "DELETE", url: "/api/sessions/nonexistent" });
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("NOT_FOUND");
	});

	it("closes an existing session and returns 204", async () => {
		// Create a host and seed a session
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "session-delete-test" },
		});
		const host = createRes.json<{ id: string }>();

		const { MetaDAL } = await import("../storage/meta.js");
		const dal = new MetaDAL(dbs.meta);
		const sessionId = "01TESTSESSION0000000000002";
		dal.createSession({ id: sessionId, hostId: host.id, status: "active" });

		const res = await server.inject({ method: "DELETE", url: `/api/sessions/${sessionId}` });
		expect(res.statusCode).toBe(204);

		// Session should now be closed in DB
		const session = dal.getSession(sessionId);
		expect(session?.status).toBe("closed");
	});
});

// ─── Channels ─────────────────────────────────────────────────────────────────

describe("GET /api/channels", () => {
	it("returns an array", async () => {
		const res = await server.inject({ method: "GET", url: "/api/channels" });
		expect(res.statusCode).toBe(200);
		expect(Array.isArray(res.json())).toBe(true);
	});

	it("filters by host_id without error", async () => {
		const res = await server.inject({
			method: "GET",
			url: "/api/channels?host_id=nonexistent",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual([]);
	});
});

describe("GET /api/channels/:id", () => {
	it("returns 404 for unknown id", async () => {
		const res = await server.inject({ method: "GET", url: "/api/channels/nonexistent" });
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("NOT_FOUND");
	});
});
