import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";
import { openTestDatabases } from "../storage/db.js";
import type { DatabaseManager } from "../storage/db.js";

// ─── Mock ssh-config-parser ───────────────────────────────────────────────────

vi.mock("../ssh/ssh-config-parser.js", () => ({
	readSshConfig: vi.fn(() => ({ entries: [], hasInclude: false })),
	parseSshConfig: vi.fn(() => ({ entries: [], hasInclude: false })),
}));

// ─── Mock ssh2 Client ─────────────────────────────────────────────────────────

vi.mock("ssh2", () => {
	return {
		Client: vi.fn().mockImplementation(() => {
			return Object.assign(new EventEmitter(), {
				connect: vi.fn(),
				end: vi.fn(),
				destroy: vi.fn(),
			});
		}),
	};
});

// ─── Mock agents ──────────────────────────────────────────────────────────────

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

// ─── Setup ────────────────────────────────────────────────────────────────────

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

// ─── GET /api/host-groups ─────────────────────────────────────────────────────

describe("GET /api/host-groups", () => {
	it("returns an empty array initially", async () => {
		const res = await server.inject({ method: "GET", url: "/api/host-groups" });
		expect(res.statusCode).toBe(200);
		const body = res.json<unknown[]>();
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBe(0);
	});

	it("returns created groups", async () => {
		await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "Production" },
		});
		await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "Staging" },
		});

		const res = await server.inject({ method: "GET", url: "/api/host-groups" });
		expect(res.statusCode).toBe(200);
		const body = res.json<Array<{ name: string }>>();
		expect(body.length).toBe(2);
		const names = body.map((g) => g.name);
		expect(names).toContain("Production");
		expect(names).toContain("Staging");
	});
});

// ─── POST /api/host-groups ────────────────────────────────────────────────────

describe("POST /api/host-groups", () => {
	it("creates a group and returns 201 with group data", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "My Group" },
		});
		expect(res.statusCode).toBe(201);
		const body = res.json<Record<string, unknown>>();
		expect(body.id).toBeTruthy();
		expect(body.name).toBe("My Group");
		expect(body.sort_order).toBe(0);
		expect(body.color).toBeNull();
		expect(body.created_at).toBeTruthy();
		expect(body.updated_at).toBeTruthy();
	});

	it("creates a group with a color", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "Colored", color: "#ff0000" },
		});
		expect(res.statusCode).toBe(201);
		const body = res.json<Record<string, unknown>>();
		expect(body.color).toBe("#ff0000");
	});

	it("returns 400 for empty name", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 400 for name exceeding 32 characters", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "a".repeat(33) },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 400 for name with invalid characters", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "bad!name@here" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 409 for duplicate name", async () => {
		await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "Duplicate" },
		});
		const res = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "Duplicate" },
		});
		expect(res.statusCode).toBe(409);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("CONFLICT");
	});
});

// ─── PUT /api/host-groups/:id ─────────────────────────────────────────────────

describe("PUT /api/host-groups/:id", () => {
	it("updates the name", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "OldName" },
		});
		const created = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/host-groups/${created.id}`,
			payload: { name: "NewName" },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		expect(body.name).toBe("NewName");
		expect(body.id).toBe(created.id);
	});

	it("updates the color", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "ColorGroup" },
		});
		const created = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/host-groups/${created.id}`,
			payload: { color: "#00ff00" },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		expect(body.color).toBe("#00ff00");
	});

	it("clears the color when null is passed", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "ClearColor", color: "#ff0000" },
		});
		const created = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/host-groups/${created.id}`,
			payload: { color: null },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		expect(body.color).toBeNull();
	});

	it("returns 400 for invalid name", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "ValidName" },
		});
		const created = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/host-groups/${created.id}`,
			payload: { name: "invalid!chars" },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 404 for nonexistent id", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/host-groups/01NONEXISTENT00000000000001",
			payload: { name: "Ghost" },
		});
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("NOT_FOUND");
	});
});

// ─── DELETE /api/host-groups/:id ─────────────────────────────────────────────

describe("DELETE /api/host-groups/:id", () => {
	it("deletes a group and returns 204", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "ToDelete" },
		});
		const created = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "DELETE",
			url: `/api/host-groups/${created.id}`,
		});
		expect(res.statusCode).toBe(204);

		// Verify it's gone from the list
		const listRes = await server.inject({ method: "GET", url: "/api/host-groups" });
		const groups = listRes.json<Array<{ id: string }>>();
		expect(groups.find((g) => g.id === created.id)).toBeUndefined();
	});

	it("returns 404 for nonexistent id", async () => {
		const res = await server.inject({
			method: "DELETE",
			url: "/api/host-groups/01NONEXISTENT00000000000002",
		});
		expect(res.statusCode).toBe(404);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("NOT_FOUND");
	});
});

// ─── PUT /api/host-groups/reorder ────────────────────────────────────────────

describe("PUT /api/host-groups/reorder", () => {
	it("reorders groups and persists new sort_order", async () => {
		const alpha = await server
			.inject({ method: "POST", url: "/api/host-groups", payload: { name: "Alpha" } })
			.then((r) => r.json<{ id: string; sort_order: number }>());
		const beta = await server
			.inject({ method: "POST", url: "/api/host-groups", payload: { name: "Beta" } })
			.then((r) => r.json<{ id: string; sort_order: number }>());
		const gamma = await server
			.inject({ method: "POST", url: "/api/host-groups", payload: { name: "Gamma" } })
			.then((r) => r.json<{ id: string; sort_order: number }>());

		// Reorder: Gamma, Alpha, Beta
		const reorderRes = await server.inject({
			method: "PUT",
			url: "/api/host-groups/order",
			payload: { group_ids: [gamma.id, alpha.id, beta.id] },
		});
		expect(reorderRes.statusCode).toBe(200);
		expect(reorderRes.json<{ ok: boolean }>().ok).toBe(true);

		// Verify order via GET
		const listRes = await server.inject({ method: "GET", url: "/api/host-groups" });
		const groups = listRes.json<Array<{ id: string; name: string }>>();
		expect(groups.map((g) => g.name)).toEqual(["Gamma", "Alpha", "Beta"]);
	});

	it("returns 400 when group_ids is missing", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/host-groups/order",
			payload: {},
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 400 when group_ids is an empty array", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/host-groups/order",
			payload: { group_ids: [] },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});

// ─── Host CRUD with host_group_id ────────────────────────────────────────────

describe("POST /api/hosts with host_group_id", () => {
	it("creates a host linked to a host group", async () => {
		const groupRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "My Hosts" },
		});
		const group = groupRes.json<{ id: string }>();

		const res = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "grouped-host", host_group_id: group.id },
		});
		expect(res.statusCode).toBe(201);
		const body = res.json<Record<string, unknown>>();
		expect(body.host_group_id).toBe(group.id);
	});
});

describe("PUT /api/hosts/:id with host_group_id", () => {
	it("assigns a host to a group", async () => {
		const groupRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "Assignable" },
		});
		const group = groupRes.json<{ id: string }>();

		const hostRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "assign-me" },
		});
		const host = hostRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/hosts/${host.id}`,
			payload: { host_group_id: group.id },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		expect(body.host_group_id).toBe(group.id);
	});

	it("clears a host group assignment when null is passed", async () => {
		const groupRes = await server.inject({
			method: "POST",
			url: "/api/host-groups",
			payload: { name: "ClearGroup" },
		});
		const group = groupRes.json<{ id: string }>();

		const hostRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "clear-group", host_group_id: group.id },
		});
		const host = hostRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: `/api/hosts/${host.id}`,
			payload: { host_group_id: null },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json<Record<string, unknown>>();
		// host_group_id is absent (not in response) when null — rowToHost omits null optional fields
		expect(body.host_group_id == null).toBe(true);
	});
});

// ─── PUT /api/hosts/reorder with group_id ────────────────────────────────────

describe("PUT /api/hosts/reorder", () => {
	it("accepts group_id (not group) in the request body", async () => {
		const hostRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "reorder-host" },
		});
		const host = hostRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PUT",
			url: "/api/hosts/order",
			payload: { group_id: null, host_ids: [host.id] },
		});
		expect(res.statusCode).toBe(204);
	});

	it("returns 400 when host_ids is empty", async () => {
		const res = await server.inject({
			method: "PUT",
			url: "/api/hosts/order",
			payload: { group_id: null, host_ids: [] },
		});
		expect(res.statusCode).toBe(400);
		const body = res.json<{ error: { code: string } }>();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});
