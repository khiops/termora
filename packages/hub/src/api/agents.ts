import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { touchToken, validateTokenRecord } from "../auth.js";
import {
	type AgentVersionReader,
	type ComputeTargetStatusOptions,
	computeTargetStatus,
} from "../session/agent-status.js";

export interface AgentRoutesDeps {
	readonly authToken?: string | null;
	readonly db?: Database.Database | null;
	readonly tokenTtlDays?: number;
	readonly getBinaryCacheDir?: () => string | Promise<string>;
	readonly hubVersion?: string;
	readonly versionReader?: AgentVersionReader;
	readonly resolveAgentBinaryPath?: () => string | null;
	readonly hubPlatform?: ComputeTargetStatusOptions["hubPlatform"];
}

export interface AgentMutationOriginGuardOptions {
	readonly allowedOrigins?: Iterable<string> | (() => Iterable<string>);
	readonly allowedHosts?: Iterable<string> | (() => Iterable<string>);
}

type AgentPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerAgentRoutes(server: FastifyInstance, deps: AgentRoutesDeps = {}): void {
	const requireBearer = createAgentBearerAuthGuard(deps);

	server.get(
		"/api/agents/targets",
		{ preHandler: requireBearer },
		async (_request: FastifyRequest, reply: FastifyReply) => {
			try {
				const cacheDir = deps.getBinaryCacheDir ? await deps.getBinaryCacheDir() : undefined;
				const status = await computeTargetStatus({
					...(cacheDir !== undefined && { cacheDir }),
					...(deps.hubVersion !== undefined && { hubVersion: deps.hubVersion }),
					...(deps.versionReader !== undefined && { versionReader: deps.versionReader }),
					...(deps.resolveAgentBinaryPath !== undefined && {
						resolveAgentBinaryPath: deps.resolveAgentBinaryPath,
					}),
					...(deps.hubPlatform !== undefined && { hubPlatform: deps.hubPlatform }),
				});
				return reply.code(200).send(status);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({
					error: {
						code: "AGENT_STATUS_ERROR",
						message,
					},
				});
			}
		},
	);
}

export function createAgentMutationOriginGuard(
	opts: AgentMutationOriginGuardOptions,
): AgentPreHandler {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const origin = request.headers.origin;
		if (!origin) return;

		const allowedOrigins = new Set(readAllowList(opts.allowedOrigins));
		const allowedHosts = new Set(readAllowList(opts.allowedHosts));
		let originHost: string;
		try {
			originHost = new URL(origin).host;
		} catch {
			return sendError(reply, 403, "ORIGIN_FORBIDDEN", "Origin is not allowed");
		}

		const host = request.headers.host;
		const originAllowed = allowedOrigins.has(origin) || allowedHosts.has(originHost);
		const hostAllowed = !host || allowedHosts.size === 0 || allowedHosts.has(host);
		if (!originAllowed || !hostAllowed) {
			return sendError(reply, 403, "ORIGIN_FORBIDDEN", "Origin or Host is not allowed");
		}
	};
}

function createAgentBearerAuthGuard(deps: AgentRoutesDeps): AgentPreHandler {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			return sendError(reply, 401, "AUTH_REQUIRED", "Authorization header required");
		}

		const [scheme, token, extra] = authHeader.split(" ");
		if (scheme !== "Bearer" || !token || extra !== undefined) {
			return sendError(reply, 401, "AUTH_REQUIRED", "Authorization header must be: Bearer <token>");
		}

		if (isValidAgentBearer(token, deps)) return;
		return sendError(reply, 401, "AUTH_INVALID", "Invalid, expired, or revoked token");
	};
}

function isValidAgentBearer(token: string, deps: AgentRoutesDeps): boolean {
	if (deps.db) {
		const record = validateTokenRecord(deps.db, token);
		if (record) {
			if (deps.tokenTtlDays !== undefined) touchToken(deps.db, record.id, deps.tokenTtlDays);
			return true;
		}
	}
	return deps.authToken !== undefined && deps.authToken !== null && token === deps.authToken;
}

function readAllowList(list: Iterable<string> | (() => Iterable<string>) | undefined): string[] {
	if (!list) return [];
	return Array.from(typeof list === "function" ? list() : list);
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string): void {
	reply.code(statusCode).send({ error: { code, message } });
}
