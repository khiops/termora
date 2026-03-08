import { DEFAULT_PROFILE } from "@nexterm/shared";
import type { TerminalProfile } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { ConfigResolver } from "../config.js";
import type { MetaDAL } from "../storage/meta.js";

interface ProfilePatchBody {
	profile: Partial<TerminalProfile>;
}

export function registerConfigRoutes(
	server: FastifyInstance,
	metaDal: MetaDAL,
	configResolver: ConfigResolver,
): void {
	// GET /api/config/defaults — Layer 1 built-in defaults
	server.get("/api/config/defaults", async () => {
		return DEFAULT_PROFILE;
	});

	// GET /api/config/ui — UI behavioral configuration
	server.get("/api/config/ui", async () => {
		return configResolver.uiConfig;
	});

	// GET /api/config/resolved?host_id=X&channel_id=Y&session_id=Z
	server.get<{
		Querystring: { host_id?: string; channel_id?: string; session_id?: string };
	}>("/api/config/resolved", async (request) => {
		const { host_id, channel_id, session_id } = request.query;
		return configResolver.resolve(host_id, channel_id, session_id);
	});

	// PATCH /api/hosts/:id/profile — update host Layer 3 profile
	server.patch<{ Params: { id: string }; Body: ProfilePatchBody }>(
		"/api/hosts/:id/profile",
		async (request, reply) => {
			const { id } = request.params;

			const host = metaDal.getHost(id);
			if (!host) {
				return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
			}

			const { profile } = request.body;
			if (profile === undefined || typeof profile !== "object" || Array.isArray(profile)) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "body.profile must be an object" },
				});
			}

			const profileJson = JSON.stringify(profile);
			metaDal.updateHostProfile(id, profileJson);

			return reply.code(200).send({ ok: true });
		},
	);

	// PATCH /api/channels/:id/profile — update channel Layer 4 profile
	server.patch<{ Params: { id: string }; Body: ProfilePatchBody }>(
		"/api/channels/:id/profile",
		async (request, reply) => {
			const { id } = request.params;

			const channel = metaDal.getChannel(id);
			if (!channel) {
				return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Channel not found" } });
			}

			const { profile } = request.body;
			if (profile === undefined || typeof profile !== "object" || Array.isArray(profile)) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "body.profile must be an object" },
				});
			}

			const profileJson = JSON.stringify(profile);
			metaDal.updateChannelProfile(id, profileJson);

			return reply.code(200).send({ ok: true });
		},
	);
}
