import { toSnakeCase } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { MetaDAL } from "../storage/meta.js";

export function registerChannelRoutes(server: FastifyInstance, metaDal: MetaDAL): void {
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
	server.patch<{ Params: { id: string }; Body: { title: string | null } }>(
		"/api/channels/:id",
		{
			schema: {
				body: {
					type: "object",
					required: ["title"],
					properties: {
						title: { type: ["string", "null"], minLength: 1, maxLength: 128 },
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
			const { title } = request.body;

			// Schema handles type, required, minLength, maxLength, and additionalProperties.
			// Whitespace-only titles still need a manual check (schema can't validate trimmed length).
			if (title !== null && title.trim().length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "title must be a string of 1\u2013128 characters, or null",
					},
				});
			}

			const channel = metaDal.getChannel(id);
			if (!channel) {
				return reply.code(404).send({
					error: { code: "NOT_FOUND", message: "Channel not found" },
				});
			}

			metaDal.updateChannelTitle(id, title?.trim() ?? null);
			const updated = metaDal.getChannel(id);
			return reply.code(200).send(toSnakeCase(updated));
		},
	);
}
