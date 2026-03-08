import { isValidUlid, toSnakeCase } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { MetaDAL } from "../storage/meta.js";

export function registerGroupRoutes(server: FastifyInstance, metaDal: MetaDAL): void {
	// GET /api/groups?host_id=X
	server.get<{ Querystring: { host_id?: string } }>("/api/groups", async (request, reply) => {
		const { host_id } = request.query;

		if (!host_id || !isValidUlid(host_id)) {
			return reply.code(400).send({
				error: {
					code: "VALIDATION_ERROR",
					message: "host_id query parameter is required and must be a valid ULID",
				},
			});
		}

		const groups = metaDal.listGroups(host_id);
		return toSnakeCase(groups);
	});

	// POST /api/groups
	server.post<{ Body: { host_id: string; name: string } }>(
		"/api/groups",
		{
			schema: {
				body: {
					type: "object",
					required: ["host_id", "name"],
					properties: {
						host_id: { type: "string" },
						name: { type: "string", minLength: 1, maxLength: 128 },
					},
					additionalProperties: false,
				},
			},
		},
		async (request, reply) => {
			const { host_id, name } = request.body;

			if (!isValidUlid(host_id)) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "host_id must be a valid ULID",
					},
				});
			}

			if (name.trim().length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "name must not be whitespace-only",
					},
				});
			}

			const group = metaDal.createGroup(host_id, name.trim());
			return reply.code(201).send(toSnakeCase(group));
		},
	);

	// PATCH /api/groups/:id
	server.patch<{ Params: { id: string }; Body: { name: string } }>(
		"/api/groups/:id",
		{
			schema: {
				body: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string", minLength: 1, maxLength: 128 },
					},
					additionalProperties: false,
				},
				params: {
					type: "object",
					required: ["id"],
					properties: {
						id: { type: "string" },
					},
				},
			},
		},
		async (request, reply) => {
			const { id } = request.params;
			const { name } = request.body;

			if (!isValidUlid(id)) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "Invalid group ID" },
				});
			}

			if (name.trim().length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "name must not be whitespace-only",
					},
				});
			}

			const updated = metaDal.renameGroup(id, name.trim());
			if (!updated) {
				return reply.code(404).send({
					error: { code: "NOT_FOUND", message: "Group not found" },
				});
			}

			return reply.code(200).send({ ok: true });
		},
	);

	// DELETE /api/groups/:id
	server.delete<{ Params: { id: string } }>("/api/groups/:id", async (request, reply) => {
		const { id } = request.params;

		if (!isValidUlid(id)) {
			return reply.code(400).send({
				error: { code: "VALIDATION_ERROR", message: "Invalid group ID" },
			});
		}

		const deleted = metaDal.deleteGroup(id);
		if (!deleted) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Group not found" },
			});
		}

		return reply.code(200).send({ ok: true });
	});
}
