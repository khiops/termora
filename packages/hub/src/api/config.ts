import {
	DEFAULT_PROFILE,
	TERMINAL_PROFILE_KEYS,
	UI_CONFIG_SECTIONS,
	UI_SECTION_KEYS,
} from "@nexterm/shared";
import type { TerminalProfile } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { ConfigResolver } from "../config.js";
import type { MetaDAL } from "../storage/meta.js";

interface ProfilePatchBody {
	profile: Partial<TerminalProfile>;
}

const APPEARANCE_KEYS = ["theme", "autoSwitch", "opacity", "scrollbar"] as const;

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

	// GET /api/config/cascade?host_id=X&channel_id=Y — full 4-layer cascade
	server.get<{
		Querystring: { host_id?: string; channel_id?: string };
	}>("/api/config/cascade", async (request) => {
		const { host_id, channel_id } = request.query;
		return configResolver.getCascade(host_id, channel_id);
	});

	// PUT /api/config/global — write terminal keys to config.toml
	server.put<{ Body: { terminal?: Record<string, unknown> } }>(
		"/api/config/global",
		async (request, reply) => {
			const body = request.body as Record<string, unknown> | null;
			const terminal = body?.terminal;
			if (!terminal || typeof terminal !== "object") {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "body.terminal must be an object" },
				});
			}

			for (const key of Object.keys(terminal as Record<string, unknown>)) {
				if (!(TERMINAL_PROFILE_KEYS as readonly string[]).includes(key)) {
					return reply.code(400).send({
						error: { code: "VALIDATION_ERROR", message: `Unknown terminal key: ${key}` },
					});
				}
			}

			for (const [key, value] of Object.entries(terminal as Record<string, unknown>)) {
				await configResolver.saveGlobalTerminal(key, value);
			}

			return { ok: true };
		},
	);

	// PUT /api/config/ui — write UI section keys to config.toml
	server.put<{ Body: Record<string, Record<string, unknown>> }>(
		"/api/config/ui",
		async (request, reply) => {
			const body = request.body as Record<string, unknown> | null;
			if (!body || typeof body !== "object") {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "body must be an object" },
				});
			}

			for (const section of Object.keys(body)) {
				if (!(UI_CONFIG_SECTIONS as readonly string[]).includes(section)) {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message: `Unknown UI section: ${section}`,
						},
					});
				}
				const sectionData = body[section];
				if (typeof sectionData !== "object" || sectionData === null) continue;

				// Validate individual keys within the section
				const allowedKeys = UI_SECTION_KEYS[section];
				if (allowedKeys) {
					for (const key of Object.keys(sectionData as Record<string, unknown>)) {
						if (!allowedKeys.includes(key)) {
							return reply.code(400).send({
								error: {
									code: "VALIDATION_ERROR",
									message: `Unknown key "${key}" in UI section "${section}"`,
								},
							});
						}
					}
				}

				for (const [key, value] of Object.entries(sectionData as Record<string, unknown>)) {
					await configResolver.saveGlobalKey(section, key, value);
				}
			}

			return { ok: true };
		},
	);

	// PUT /api/config/appearance — write appearance keys to config.toml
	server.put("/api/config/appearance", async (request, reply) => {
		const body = request.body as Record<string, unknown> | null;
		if (!body || typeof body !== "object") {
			return reply.code(400).send({
				error: { code: "VALIDATION_ERROR", message: "body must be an object" },
			});
		}

		for (const key of Object.keys(body)) {
			if (!(APPEARANCE_KEYS as readonly string[]).includes(key)) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: `Unknown appearance key: ${key}`,
					},
				});
			}
		}

		for (const [key, value] of Object.entries(body)) {
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				// Nested object (autoSwitch, opacity, scrollbar) — write each sub-key
				for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
					await configResolver.saveGlobalKey(`appearance.${key}`, subKey, subValue);
				}
			} else {
				// Flat key (theme)
				await configResolver.saveGlobalKey("appearance", key, value);
			}
		}

		return { ok: true };
	});

	// GET /api/hosts/:id/profile — read raw host profile_json
	server.get<{ Params: { id: string } }>("/api/hosts/:id/profile", async (request, reply) => {
		const { id } = request.params;
		const host = metaDal.getHost(id);
		if (!host) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Host not found" },
			});
		}
		const profileRaw = metaDal.getHostProfile(id);
		return { profile: profileRaw ? JSON.parse(profileRaw) : {} };
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

	// GET /api/channels/:id/profile — read raw channel profile_json
	server.get<{ Params: { id: string } }>("/api/channels/:id/profile", async (request, reply) => {
		const { id } = request.params;
		const channel = metaDal.getChannel(id);
		if (!channel) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Channel not found" },
			});
		}
		const profileRaw = metaDal.getChannelProfile(id);
		return { profile: profileRaw ? JSON.parse(profileRaw) : {} };
	});

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
