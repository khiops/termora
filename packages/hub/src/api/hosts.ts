import { type Host, ELEVATION_METHODS_ALL, toSnakeCase } from "@nexterm/shared";
import type { SshConfigImport } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { ParseResult } from "../ssh/ssh-config-parser.js";
import { readSshConfig } from "../ssh/ssh-config-parser.js";
import type { MetaDAL } from "../storage/meta.js";

interface CreateHostBody {
	type: "local" | "ssh";
	label: string;
	ssh_host?: string;
	ssh_port?: number;
	ssh_auth?: "agent" | "key" | "password";
	ssh_key_path?: string;
	icon_type?: "auto" | "emoji" | "image";
	icon_value?: string;
	color?: string;
	default_shell?: string;
	default_cwd?: string;
	trust_remote_hints?: "apply" | "ask" | "ignore";
	host_group?: string | null;
	host_group_id?: string | null;
	ssh_config_host?: string | null;
	ssh_user?: string | null;
	keep_alive_seconds?: number;
	history_retention_days?: number;
	profile_json?: string;
	elevation_method?: "sudo" | "doas" | "pkexec" | "gsudo" | "custom" | null;
	custom_command?: string | null;
}

interface UpdateHostBody {
	type?: "local" | "ssh";
	label?: string;
	ssh_host?: string;
	ssh_port?: number;
	ssh_auth?: "agent" | "key" | "password";
	ssh_key_path?: string;
	icon_type?: "auto" | "emoji" | "image";
	icon_value?: string;
	color?: string;
	default_shell?: string;
	default_cwd?: string;
	trust_remote_hints?: "apply" | "ask" | "ignore";
	host_group?: string | null;
	host_group_id?: string | null;
	ssh_config_host?: string | null;
	ssh_user?: string | null;
	keep_alive_seconds?: number;
	history_retention_days?: number;
	profile_json?: string;
	elevation_method?: "sudo" | "doas" | "pkexec" | "gsudo" | "custom" | null;
	custom_command?: string | null;
}

function validateCreateHost(body: CreateHostBody): string | null {
	if (!body.label || body.label.trim().length === 0) {
		return "Label is required";
	}
	if (body.label.length > 64) {
		return "Label must be 64 characters or fewer";
	}
	if (!/^[a-zA-Z0-9._-]+$/.test(body.label)) {
		return "Label must contain only alphanumeric characters, dots, dashes, and underscores";
	}
	if (body.type !== "local" && body.type !== "ssh") {
		return "type must be 'local' or 'ssh'";
	}
	if (body.type === "ssh") {
		if (!body.ssh_host || body.ssh_host.includes("\0")) {
			return "ssh_host is required for SSH hosts and must not contain null bytes";
		}
		if (!/^[a-zA-Z0-9@._:-]+$/.test(body.ssh_host)) {
			return "ssh_host must contain only valid hostname characters";
		}
		if (
			body.ssh_auth !== undefined &&
			body.ssh_auth !== "agent" &&
			body.ssh_auth !== "key" &&
			body.ssh_auth !== "password"
		) {
			return "ssh_auth must be 'agent', 'key', or 'password'";
		}
		if (body.ssh_auth === "key" && (!body.ssh_key_path || body.ssh_key_path.trim().length === 0)) {
			return "ssh_key_path is required when ssh_auth is 'key'";
		}
	}
	if (body.ssh_port !== undefined) {
		if (!Number.isInteger(body.ssh_port) || body.ssh_port < 1 || body.ssh_port > 65535) {
			return "ssh_port must be an integer between 1 and 65535";
		}
	}
	if (body.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
		return "color must be in hex format #rrggbb";
	}
	if (
		body.elevation_method !== undefined &&
		body.elevation_method !== null &&
		!(ELEVATION_METHODS_ALL as readonly string[]).includes(body.elevation_method)
	) {
		return `elevation_method must be one of: ${ELEVATION_METHODS_ALL.join(", ")}`;
	}
	return null;
}

function validateAndClampVisualProfile(vp: Record<string, unknown>): string | null {
	const hexRe = /^#[0-9a-fA-F]{6}$/;
	const colorsToCheck = [
		(vp.banner as Record<string, unknown> | undefined)?.bgColor,
		(vp.banner as Record<string, unknown> | undefined)?.textColor,
		(vp.border as Record<string, unknown> | undefined)?.color,
		(vp.tint as Record<string, unknown> | undefined)?.color,
	].filter((c): c is string => typeof c === "string" && c !== "");
	for (const c of colorsToCheck) {
		if (!hexRe.test(c)) return `Invalid color value: ${c}`;
	}
	const tint = vp.tint as Record<string, unknown> | undefined;
	if (typeof tint?.opacity === "number" && tint.opacity > 15) {
		tint.opacity = 15;
	}
	return null;
}

/**
 * Infer the OS of a host for launch profile filtering.
 *
 * Resolution order:
 * 1. Agent-reported shells (discoveredShells): infer from path patterns.
 * 2. Local host: use process.platform.
 * 3. SSH host without HELLO data: 'unknown' (show all profiles).
 *
 * @param host  The host record from meta.db.
 */
export function resolveHostOs(host: Host): string {
	if (host.discoveredShells && host.discoveredShells.length > 0) {
		const hasWindowsShells = host.discoveredShells.some(
			(s) => s.includes("\\") || s.toLowerCase().endsWith(".exe"),
		);
		if (hasWindowsShells) return "windows";
		const hasMacPaths = host.discoveredShells.some(
			(s) => s.includes("/usr/local/") || s.includes("/opt/homebrew/"),
		);
		if (hasMacPaths) return "darwin";
		return "linux";
	}
	if (host.type === "local") {
		if (process.platform === "win32") return "windows";
		if (process.platform === "darwin") return "darwin";
		return "linux";
	}
	return "unknown";
}

export function registerHostRoutes(server: FastifyInstance, metaDal: MetaDAL): void {
	// GET /api/hosts
	server.get("/api/hosts", async () => {
		const hosts = metaDal.listHosts();
		return toSnakeCase(hosts);
	});

	// POST /api/hosts
	server.post<{ Body: CreateHostBody }>("/api/hosts", async (request, reply) => {
		const body = request.body;

		const validationError = validateCreateHost(body);
		if (validationError) {
			return reply
				.code(400)
				.send({ error: { code: "VALIDATION_ERROR", message: validationError } });
		}

		// Validate visual profile colors in profile_json (INV-09)
		if (body.profile_json !== undefined) {
			try {
				const profileObj =
					typeof body.profile_json === "string" ? JSON.parse(body.profile_json) : body.profile_json;
				if (profileObj?.visualProfile) {
					const colorError = validateAndClampVisualProfile(profileObj.visualProfile);
					if (colorError) {
						return reply.code(400).send({
							error: { code: "VALIDATION_ERROR", message: colorError },
						});
					}
				}
			} catch {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "Invalid profile_json format",
					},
				});
			}
		}

		// Duplicate label check
		const existing = metaDal.getHostByLabel(body.label.trim());
		if (existing) {
			return reply
				.code(409)
				.send({ error: { code: "CONFLICT", message: "Host with this label already exists" } });
		}

		// Build create input conditionally to satisfy exactOptionalPropertyTypes
		const host = metaDal.createHost({
			type: body.type,
			label: body.label.trim(),
			...(body.ssh_host !== undefined && { sshHost: body.ssh_host }),
			...(body.ssh_port !== undefined && { sshPort: body.ssh_port }),
			...(body.ssh_auth !== undefined && { sshAuth: body.ssh_auth }),
			...(body.ssh_key_path !== undefined && { sshKeyPath: body.ssh_key_path }),
			...(body.icon_type !== undefined && { iconType: body.icon_type }),
			...(body.icon_value !== undefined && { iconValue: body.icon_value }),
			...(body.color !== undefined && { color: body.color }),
			...(body.trust_remote_hints !== undefined && { trustRemoteHints: body.trust_remote_hints }),
			...(body.default_shell !== undefined && { defaultShell: body.default_shell }),
			...(body.default_cwd !== undefined && { defaultCwd: body.default_cwd }),
			...(body.host_group !== undefined && { hostGroup: body.host_group }),
			...(body.host_group_id !== undefined && { hostGroupId: body.host_group_id }),
			...(body.ssh_config_host !== undefined && { sshConfigHost: body.ssh_config_host }),
			...(body.ssh_user !== undefined && { sshUser: body.ssh_user }),
			...(body.keep_alive_seconds !== undefined && { keepAliveSeconds: body.keep_alive_seconds }),
			...(body.history_retention_days !== undefined && {
				historyRetentionDays: body.history_retention_days,
			}),
			...(body.profile_json !== undefined && { profileJson: body.profile_json }),
			...(body.elevation_method !== undefined && { elevationMethod: body.elevation_method }),
			...(body.custom_command !== undefined && { customCommand: body.custom_command }),
		});

		return reply.code(201).send(toSnakeCase(host));
	});

	// PUT /api/hosts/reorder — reorder hosts within a group
	server.put<{ Body: { group_id: string | null; host_ids: string[] } }>(
		"/api/hosts/reorder",
		async (request, reply) => {
			const { group_id, host_ids } = request.body;
			if (!Array.isArray(host_ids) || host_ids.length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "host_ids must be a non-empty array",
					},
				});
			}
			metaDal.reorderHosts(group_id ?? null, host_ids);
			return reply.code(204).send();
		},
	);

	// GET /api/hosts/:id
	server.get<{ Params: { id: string } }>("/api/hosts/:id", async (request, reply) => {
		const host = metaDal.getHost(request.params.id);
		if (!host) {
			return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
		}
		return toSnakeCase(host);
	});

	// PUT /api/hosts/:id
	server.put<{ Params: { id: string }; Body: UpdateHostBody }>(
		"/api/hosts/:id",
		async (request, reply) => {
			const host = metaDal.getHost(request.params.id);
			if (!host) {
				return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
			}

			const body = request.body;

			// Validate color if provided
			if (body.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "color must be in hex format #rrggbb" },
				});
			}

			// Validate ssh_port if provided
			if (body.ssh_port !== undefined) {
				if (!Number.isInteger(body.ssh_port) || body.ssh_port < 1 || body.ssh_port > 65535) {
					return reply.code(400).send({
						error: { code: "VALIDATION_ERROR", message: "ssh_port must be between 1 and 65535" },
					});
				}
			}

			// Validate visual profile colors (INV-09)
			if (body.profile_json !== undefined) {
				try {
					const profileObj =
						typeof body.profile_json === "string"
							? JSON.parse(body.profile_json)
							: body.profile_json;
					if (profileObj?.visualProfile) {
						const colorError = validateAndClampVisualProfile(profileObj.visualProfile);
						if (colorError) {
							return reply.code(400).send({
								error: { code: "VALIDATION_ERROR", message: colorError },
							});
						}
					}
				} catch {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid profile_json format",
						},
					});
				}
			}

			// Validate label if provided
			if (body.label !== undefined) {
				if (body.label.trim().length === 0 || body.label.length > 64) {
					return reply.code(400).send({
						error: { code: "VALIDATION_ERROR", message: "Label must be 1-64 characters" },
					});
				}
				if (!/^[a-zA-Z0-9._-]+$/.test(body.label)) {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message:
								"Label must contain only alphanumeric characters, dots, dashes, and underscores",
						},
					});
				}
				// Duplicate label check (excluding self)
				const labelConflict = metaDal.getHostByLabel(body.label.trim());
				if (labelConflict && labelConflict.id !== request.params.id) {
					return reply
						.code(409)
						.send({ error: { code: "CONFLICT", message: "Host with this label already exists" } });
				}
			}

			// Build a partial update — only include fields present in the request body.
			// MetaDAL's updateHost uses `camel in input` to detect which columns to SET,
			// so passing `key: undefined` would incorrectly NULL out required columns.
			const updateInput: Parameters<typeof metaDal.updateHost>[1] = {};
			if (body.type !== undefined) updateInput.type = body.type;
			if (body.label !== undefined) updateInput.label = body.label.trim();
			if (body.ssh_host !== undefined) updateInput.sshHost = body.ssh_host;
			if (body.ssh_port !== undefined) updateInput.sshPort = body.ssh_port;
			if (body.ssh_auth !== undefined) updateInput.sshAuth = body.ssh_auth;
			if (body.ssh_key_path !== undefined) updateInput.sshKeyPath = body.ssh_key_path;
			if (body.icon_type !== undefined) updateInput.iconType = body.icon_type;
			if (body.icon_value !== undefined) updateInput.iconValue = body.icon_value;
			if (body.color !== undefined) updateInput.color = body.color;
			if (body.trust_remote_hints !== undefined)
				updateInput.trustRemoteHints = body.trust_remote_hints;
			if (body.default_shell !== undefined) updateInput.defaultShell = body.default_shell;
			if (body.default_cwd !== undefined) updateInput.defaultCwd = body.default_cwd;
			if (body.host_group !== undefined) updateInput.hostGroup = body.host_group;
			if (body.host_group_id !== undefined) updateInput.hostGroupId = body.host_group_id;
			if (body.ssh_config_host !== undefined) updateInput.sshConfigHost = body.ssh_config_host;
			if (body.ssh_user !== undefined) updateInput.sshUser = body.ssh_user;
			if (body.keep_alive_seconds !== undefined)
				updateInput.keepAliveSeconds = body.keep_alive_seconds;
			if (body.history_retention_days !== undefined)
				updateInput.historyRetentionDays = body.history_retention_days;
			if (body.profile_json !== undefined) updateInput.profileJson = body.profile_json;
			if (body.elevation_method !== undefined) {
				if (
					body.elevation_method !== null &&
					!(ELEVATION_METHODS_ALL as readonly string[]).includes(body.elevation_method)
				) {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message: `elevation_method must be one of: ${ELEVATION_METHODS_ALL.join(", ")}`,
						},
					});
				}
				updateInput.elevationMethod = body.elevation_method;
			}
			if (body.custom_command !== undefined) updateInput.customCommand = body.custom_command;

			const updated = metaDal.updateHost(request.params.id, updateInput);

			return toSnakeCase(updated);
		},
	);

	// DELETE /api/hosts/:id
	server.delete<{ Params: { id: string } }>("/api/hosts/:id", async (request, reply) => {
		const deleted = metaDal.deleteHost(request.params.id);
		if (!deleted) {
			return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
		}
		return reply.code(204).send();
	});

	// POST /api/hosts/:id/duplicate — duplicate a host
	server.post<{ Params: { id: string } }>("/api/hosts/:id/duplicate", async (request, reply) => {
		const result = metaDal.duplicateHost(request.params.id);
		if (!result) {
			return reply.code(400).send({
				error: {
					code: "VALIDATION_ERROR",
					message: "Host not found or cannot be duplicated",
				},
			});
		}
		return reply.code(201).send(toSnakeCase(result));
	});

	// PUT /api/hosts/:id/welcome — set welcome channel for a host
	server.put<{ Params: { id: string }; Body: { channel_id: string } }>(
		"/api/hosts/:id/welcome",
		async (request, reply) => {
			const host = metaDal.getHost(request.params.id);
			if (!host) {
				return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
			}

			const { channel_id } = request.body;
			if (!channel_id || typeof channel_id !== "string") {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "channel_id is required" },
				});
			}

			const channelWithHost = metaDal.getChannelWithHost(channel_id);
			if (!channelWithHost) {
				return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Channel not found" } });
			}

			if (channelWithHost.hostId !== request.params.id) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: "Channel does not belong to this host" },
				});
			}

			metaDal.setWelcomeChannel(channel_id);
			return reply.code(200).send({ ok: true });
		},
	);

	// DELETE /api/hosts/:id/welcome — clear welcome channel for a host
	server.delete<{ Params: { id: string } }>("/api/hosts/:id/welcome", async (request, reply) => {
		const { id } = request.params;
		const welcome = metaDal.getWelcomeChannel(id);
		if (welcome) {
			metaDal.clearWelcomeChannel(welcome.id);
		}
		return reply.code(204).send();
	});

	// GET /api/ssh-config — parse user's ~/.ssh/config
	server.get("/api/ssh-config", async (_request, reply) => {
		try {
			const result = readSshConfig();
			return { entries: toSnakeCase(result.entries), has_include: result.hasInclude };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				return reply.code(404).send({
					error: {
						code: "NOT_FOUND",
						message: "No SSH config file found at ~/.ssh/config",
					},
				});
			}
			throw err;
		}
	});

	// POST /api/hosts/import — batch import hosts from SSH config
	server.post<{ Body: { entries: SshConfigImport[] } }>(
		"/api/hosts/import",
		async (request, reply) => {
			const { entries } = request.body;

			if (!Array.isArray(entries) || entries.length === 0) {
				return reply.code(400).send({
					error: {
						code: "VALIDATION_ERROR",
						message: "entries must be a non-empty array",
					},
				});
			}

			// Parse SSH config to get full details
			let sshResult: ParseResult;
			try {
				sshResult = readSshConfig();
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					return reply.code(404).send({
						error: {
							code: "NOT_FOUND",
							message: "No SSH config file found at ~/.ssh/config",
						},
					});
				}
				throw err;
			}

			// Build lookup map by name
			const entryMap = new Map(sshResult.entries.map((e) => [e.name, e]));

			// Validate all entries have matching SSH config entries
			for (const entry of entries) {
				if (!entry.name || !entry.label) {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message: "Each entry must have name and label",
						},
					});
				}
				if (!entryMap.has(entry.name)) {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message: `SSH config entry not found: ${entry.name}`,
						},
					});
				}
			}

			// Check ALL labels for conflicts before creating any
			const conflictingLabels: string[] = [];
			for (const entry of entries) {
				const existing = metaDal.getHostByLabel(entry.label.trim());
				if (existing) {
					conflictingLabels.push(entry.label);
				}
			}
			if (conflictingLabels.length > 0) {
				return reply.code(409).send({
					error: {
						code: "CONFLICT",
						message: `Labels already in use: ${conflictingLabels.join(", ")}`,
						conflicting_labels: conflictingLabels,
					},
				});
			}

			// Build host inputs and create in a transaction
			const inputs = entries.map((entry) => {
				// Safe: validated above that all entries exist in entryMap
				const sshEntry = entryMap.get(entry.name) as NonNullable<ReturnType<typeof entryMap.get>>;
				return {
					type: "ssh" as const,
					label: entry.label.trim(),
					sshHost: sshEntry.hostname ?? sshEntry.name,
					sshPort: sshEntry.port,
					...(sshEntry.user != null && { sshUser: sshEntry.user }),
					...(sshEntry.identityFile != null && {
						sshKeyPath: sshEntry.identityFile,
						sshAuth: "key" as const,
					}),
					sshConfigHost: sshEntry.name,
					...(entry.hostGroup !== undefined && { hostGroup: entry.hostGroup }),
				};
			});

			const hosts = metaDal.importHosts(inputs);
			return reply.code(201).send(toSnakeCase(hosts));
		},
	);

	// GET /api/hosts/:id/profiles — filtered launch profiles for this host
	server.get<{ Params: { id: string }; Querystring: { os?: string } }>(
		"/api/hosts/:id/profiles",
		async (request, reply) => {
			const host = metaDal.getHost(request.params.id);
			if (!host) {
				return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
			}
			// Auto-resolve OS from host data when client does not supply ?os=.
			// This ensures profiles are correctly filtered without requiring the
			// client to detect and send the remote OS.
			const hostOs = request.query.os ?? resolveHostOs(host);
			const profiles = metaDal.listHostProfiles(request.params.id, hostOs);
			return toSnakeCase(profiles);
		},
	);

	// PUT /api/hosts/:id/profiles/:profileId — upsert override
	server.put<{
		Params: { id: string; profileId: string };
		Body: { override_type: string; sort_order?: number };
	}>("/api/hosts/:id/profiles/:profileId", async (request, reply) => {
		const host = metaDal.getHost(request.params.id);
		if (!host) {
			return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
		}

		const profile = metaDal.getLaunchProfile(request.params.profileId);
		if (!profile) {
			return reply
				.code(404)
				.send({ error: { code: "NOT_FOUND", message: "Launch profile not found" } });
		}

		const { override_type, sort_order } = request.body;
		if (!["pin", "hide", "default"].includes(override_type)) {
			return reply.code(400).send({
				error: {
					code: "VALIDATION_ERROR",
					message: "override_type must be 'pin', 'hide', or 'default'",
				},
			});
		}

		metaDal.upsertHostProfileOverride(
			request.params.id,
			request.params.profileId,
			override_type,
			sort_order,
		);
		return reply.code(204).send();
	});

	// DELETE /api/hosts/:id/profiles/:profileId — remove override
	server.delete<{ Params: { id: string; profileId: string } }>(
		"/api/hosts/:id/profiles/:profileId",
		async (request, reply) => {
			const deleted = metaDal.deleteHostProfileOverride(
				request.params.id,
				request.params.profileId,
			);
			if (!deleted) {
				return reply
					.code(404)
					.send({ error: { code: "NOT_FOUND", message: "Override not found" } });
			}
			return reply.code(204).send();
		},
	);
}
