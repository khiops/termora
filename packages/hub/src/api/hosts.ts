import { toSnakeCase } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import { Client } from "ssh2";
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
}

const SSH_TEST_TIMEOUT_MS = 10_000;

function validateCreateHost(body: CreateHostBody): string | null {
	if (!body.label || body.label.trim().length === 0) {
		return "Label is required";
	}
	if (body.label.length > 64) {
		return "Label must be 64 characters or fewer";
	}
	if (!/^[a-zA-Z0-9_-]+$/.test(body.label)) {
		return "Label must contain only alphanumeric characters, dashes, and underscores";
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
	return null;
}

async function testSshConnectivity(
	host: string,
	port: number,
	auth: "agent" | "key" | "password",
	keyPath?: string,
): Promise<{ ok: boolean; message?: string }> {
	return new Promise((resolve) => {
		const client = new Client();

		const timer = setTimeout(() => {
			client.destroy();
			resolve({ ok: false, message: "Connection timed out" });
		}, SSH_TEST_TIMEOUT_MS);

		client.on("ready", () => {
			clearTimeout(timer);
			client.end();
			resolve({ ok: true });
		});

		client.on("error", (err: Error) => {
			clearTimeout(timer);
			// A banner/handshake error means we reached the server — it's reachable
			// even if auth fails. Only report connectivity errors as failure.
			const msg = err.message ?? "Unknown error";
			if (
				msg.includes("ECONNREFUSED") ||
				msg.includes("ETIMEDOUT") ||
				msg.includes("EHOSTUNREACH") ||
				msg.includes("ENOTFOUND")
			) {
				resolve({ ok: false, message: msg });
			} else {
				// Auth/banner errors = server is reachable; close the client cleanly
				client.end();
				resolve({ ok: true });
			}
		});

		try {
			const connectConfig: Parameters<InstanceType<typeof Client>["connect"]>[0] = {
				host,
				port,
				username: process.env.USER ?? "root",
				readyTimeout: SSH_TEST_TIMEOUT_MS,
			};

			if (auth === "agent" || auth === "key") {
				// For key auth: we don't have the key content here, fall back to agent
				const authSock = process.env.SSH_AUTH_SOCK;
				if (authSock) {
					connectConfig.agent = authSock;
				}
			} else {
				// password: we cannot actually auth without credentials, but
				// the connect attempt will verify reachability
				connectConfig.password = "";
			}

			client.connect(connectConfig);
		} catch (err) {
			clearTimeout(timer);
			resolve({
				ok: false,
				message: err instanceof Error ? err.message : "Connection failed",
			});
		}
	});
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
		});

		return reply.code(201).send(toSnakeCase(host));
	});

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

			// Validate label if provided
			if (body.label !== undefined) {
				if (body.label.trim().length === 0 || body.label.length > 64) {
					return reply.code(400).send({
						error: { code: "VALIDATION_ERROR", message: "Label must be 1-64 characters" },
					});
				}
				if (!/^[a-zA-Z0-9_-]+$/.test(body.label)) {
					return reply.code(400).send({
						error: {
							code: "VALIDATION_ERROR",
							message: "Label must contain only alphanumeric characters, dashes, and underscores",
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

	// POST /api/hosts/:id/test
	server.post<{ Params: { id: string } }>("/api/hosts/:id/test", async (request, reply) => {
		const host = metaDal.getHost(request.params.id);
		if (!host) {
			return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Host not found" } });
		}

		if (host.type === "local") {
			return { ok: true };
		}

		// SSH connectivity test
		if (!host.sshHost) {
			return { ok: false, message: "Host has no ssh_host configured" };
		}

		const result = await testSshConnectivity(
			host.sshHost,
			host.sshPort ?? 22,
			host.sshAuth ?? "agent",
			host.sshKeyPath,
		);

		return result;
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
}
