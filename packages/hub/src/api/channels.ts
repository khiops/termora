import { isValidUlid, toSnakeCase } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session/session-manager.js";
import type { MetaDAL } from "../storage/meta.js";

export function registerChannelRoutes(
	server: FastifyInstance,
	metaDal: MetaDAL,
	sessionManager: SessionManager,
): void {
	// GET /api/channels?host_id=X
	// host_id filtering: look up sessions for that host, then get channels for those sessions
	server.get<{ Querystring: { host_id?: string; session_id?: string } }>(
		"/api/channels",
		async (request) => {
			const { host_id, session_id } = request.query;

			if (session_id) {
				const channels = metaDal.listChannels(session_id);
				return toSnakeCase(channels);
			}

			if (host_id) {
				const sessions = metaDal.listSessions(host_id);
				const channels = sessions.flatMap((s) => metaDal.listChannels(s.id));
				return toSnakeCase(channels);
			}

			const channels = metaDal.listChannels();
			return toSnakeCase(channels);
		},
	);

	// GET /api/channels/:id
	server.get<{ Params: { id: string } }>("/api/channels/:id", async (request, reply) => {
		const channel = metaDal.getChannel(request.params.id);
		if (!channel) {
			return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Channel not found" } });
		}
		return toSnakeCase(channel);
	});

	// PATCH /api/channels/:id
	server.patch<{
		Params: { id: string };
		Body: { title?: string | null; group_id?: string | null };
	}>(
		"/api/channels/:id",
		{
			schema: {
				body: {
					type: "object",
					properties: {
						title: { type: ["string", "null"], minLength: 1, maxLength: 128 },
						group_id: { type: ["string", "null"] },
					},
					anyOf: [{ required: ["title"] }, { required: ["group_id"] }],
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
			const { title, group_id } = request.body;

			// Schema handles type, minLength, maxLength, and additionalProperties.
			// Whitespace-only titles still need a manual check (schema can't validate trimmed length).
			if (title !== undefined && title !== null && title.trim().length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "title must be a string of 1\u2013128 characters, or null",
					},
				});
			}

			if (group_id !== undefined && group_id !== null && !isValidUlid(group_id)) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "group_id must be a valid ULID or null",
					},
				});
			}

			const channel = metaDal.getChannel(id);
			if (!channel) {
				return reply.code(404).send({
					error: { code: "NOT_FOUND", message: "Channel not found" },
				});
			}

			if (title !== undefined) {
				metaDal.updateChannelTitle(id, title?.trim() ?? null);
			}
			if (group_id !== undefined) {
				metaDal.updateChannelGroupId(id, group_id);
			}

			const updated = metaDal.getChannel(id);
			return reply.code(200).send(toSnakeCase(updated));
		},
	);

	// DELETE /api/channels/:id — destroy a channel's PTY and mark it dead
	server.delete<{ Params: { id: string } }>("/api/channels/:id", async (request, reply) => {
		const { id } = request.params;

		if (!isValidUlid(id)) {
			return reply.code(400).send({
				error: { code: "VALIDATION_ERROR", message: "Invalid channel ID" },
			});
		}

		const channel = metaDal.getChannel(id);
		if (!channel) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Channel not found" },
			});
		}

		// Already dead — idempotent success
		if (channel.status === "dead") {
			return reply.code(200).send({ ok: true });
		}

		if (!sessionManager.destroyChannel(id)) {
			// Channel exists in DB but not in SessionManager's in-memory map
			// (e.g. orphaned after hub restart). Mark dead directly.
			metaDal.updateChannelStatus(id, "dead");
		}
		return reply.code(200).send({ ok: true });
	});
}
