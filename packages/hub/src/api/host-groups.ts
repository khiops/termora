import type { HostGroup } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { MetaDAL } from "../storage/meta.js";

const NAME_RE = /^[a-zA-Z0-9 _-]{1,32}$/;

function hostGroupToResponse(g: HostGroup) {
	return {
		id: g.id,
		name: g.name,
		sort_order: g.sortOrder,
		color: g.color,
		created_at: g.createdAt,
		updated_at: g.updatedAt,
	};
}

export function registerHostGroupRoutes(server: FastifyInstance, metaDal: MetaDAL): void {
	// GET /api/host-groups
	server.get("/api/host-groups", async () => {
		const groups = metaDal.listHostGroupEntities();
		return groups.map(hostGroupToResponse);
	});

	// POST /api/host-groups
	server.post<{ Body: { name: string; color?: string | null } }>(
		"/api/host-groups",
		async (request, reply) => {
			const { name, color } = request.body;

			if (!name || !NAME_RE.test(name)) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "name must be 1-32 characters, alphanumeric with spaces, dashes, underscores",
					},
				});
			}

			try {
				const group = metaDal.createHostGroup(name.trim(), color ?? null);
				return reply.code(201).send(hostGroupToResponse(group));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("UNIQUE constraint failed")) {
					return reply.code(409).send({
						error: { code: "CONFLICT", message: "Host group with this name already exists" },
					});
				}
				throw err;
			}
		},
	);

	// PUT /api/host-groups/reorder — BEFORE /:id to avoid param collision
	server.put<{ Body: { group_ids: string[] } }>(
		"/api/host-groups/reorder",
		async (request, reply) => {
			const { group_ids } = request.body;

			if (!Array.isArray(group_ids) || group_ids.length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "group_ids must be a non-empty array",
					},
				});
			}

			metaDal.reorderHostGroups(group_ids);
			return reply.code(200).send({ ok: true });
		},
	);

	// PUT /api/host-groups/:id
	server.put<{ Params: { id: string }; Body: { name?: string; color?: string | null } }>(
		"/api/host-groups/:id",
		async (request, reply) => {
			const { id } = request.params;
			const { name, color } = request.body;

			if (name !== undefined && !NAME_RE.test(name)) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "name must be 1-32 characters, alphanumeric with spaces, dashes, underscores",
					},
				});
			}

			const fields: { name?: string; color?: string | null } = {};
			if (name !== undefined) fields.name = name.trim();
			if ("color" in request.body) fields.color = color ?? null;

			try {
				const updated = metaDal.updateHostGroup(id, fields);
				if (!updated) {
					return reply.code(404).send({
						error: { code: "NOT_FOUND", message: "Host group not found" },
					});
				}
				return reply.code(200).send(hostGroupToResponse(updated));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("UNIQUE constraint failed")) {
					return reply.code(409).send({
						error: { code: "CONFLICT", message: "Host group with this name already exists" },
					});
				}
				throw err;
			}
		},
	);

	// DELETE /api/host-groups/:id
	server.delete<{ Params: { id: string } }>("/api/host-groups/:id", async (request, reply) => {
		const deleted = metaDal.deleteHostGroupEntity(request.params.id);
		if (!deleted) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Host group not found" },
			});
		}
		return reply.code(204).send();
	});
}
