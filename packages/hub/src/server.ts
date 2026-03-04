import websocket from "@fastify/websocket";
import { DEFAULT_PORT } from "@nexterm/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerChannelRoutes } from "./api/channels.js";
import { registerHostRoutes } from "./api/hosts.js";
import { registerSessionRoutes } from "./api/sessions.js";
import { validateToken } from "./auth.js";
import { SessionManager } from "./session/session-manager.js";
import type { DatabaseManager } from "./storage/db.js";
import { registerWsRoutes } from "./ws/ws-handler.js";

export interface ServerOptions {
	host?: string; // default: "127.0.0.1"
	port?: number; // default: DEFAULT_PORT (4100)
	logger?: boolean; // default: true
	dbManager?: DatabaseManager; // when provided, WS routes are registered
	authToken?: string; // when provided, Bearer auth is enforced on all routes except /health
}

export async function createServer(options?: ServerOptions): Promise<FastifyInstance> {
	const server = Fastify({
		logger: options?.logger ?? true,
	});

	// Auth enforcement — applied before route matching
	if (options?.authToken) {
		const expectedToken = options.authToken;
		server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
			const url = request.url;

			// Unauthenticated endpoints
			if (url === "/health" || url === "/api/health") return;
			if (url === "/api/pair/verify") return;

			const authHeader = request.headers.authorization;
			if (!authHeader) {
				server.log.warn({ url }, "auth: missing Authorization header");
				return reply.code(401).send({
					error: "AUTH_REQUIRED",
					message: "Authorization header required",
				});
			}

			const [scheme, token] = authHeader.split(" ");
			if (scheme !== "Bearer" || !token) {
				server.log.warn({ url }, "auth: malformed Authorization header");
				return reply.code(401).send({
					error: "AUTH_REQUIRED",
					message: "Authorization header must be: Bearer <token>",
				});
			}

			if (!validateToken(token, expectedToken)) {
				server.log.warn({ url }, "auth: invalid token");
				return reply.code(401).send({
					error: "AUTH_INVALID",
					message: "Invalid token",
				});
			}

			server.log.debug({ url }, "auth: accepted");
		});
	}

	// Health endpoint
	server.get("/health", async () => {
		return { status: "ok", version: "0.1.0", uptime: process.uptime() };
	});

	// Register WebSocket support and routes when a dbManager is provided
	if (options?.dbManager) {
		await server.register(websocket);
		const sessionManager = new SessionManager(options.dbManager);
		const metaDal = sessionManager.getMetaDal();
		await sessionManager.ensureLocalHost();
		await registerWsRoutes(server, sessionManager, options.authToken);
		registerHostRoutes(server, metaDal);
		registerSessionRoutes(server, metaDal, sessionManager);
		registerChannelRoutes(server, metaDal);
		server.addHook("onClose", async () => {
			await sessionManager.shutdown();
		});
	}

	return server;
}

export async function startServer(
	server: FastifyInstance,
	options?: ServerOptions,
): Promise<string> {
	const host = options?.host ?? "127.0.0.1";
	const port = options?.port ?? DEFAULT_PORT;

	const address = await server.listen({ host, port });
	return address;
}
