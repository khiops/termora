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
}
