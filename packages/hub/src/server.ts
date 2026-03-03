import websocket from "@fastify/websocket";
import { DEFAULT_PORT } from "@nexterm/shared";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { SessionManager } from "./session/session-manager.js";
import type { DatabaseManager } from "./storage/db.js";
import { registerWsRoutes } from "./ws/ws-handler.js";

export interface ServerOptions {
	host?: string; // default: "127.0.0.1"
	port?: number; // default: DEFAULT_PORT (4100)
	logger?: boolean; // default: true
	dbManager?: DatabaseManager; // when provided, WS routes are registered
}

export async function createServer(options?: ServerOptions): Promise<FastifyInstance> {
	const server = Fastify({
		logger: options?.logger ?? true,
	});

	// Health endpoint
	server.get("/health", async () => {
		return { status: "ok", version: "0.1.0", uptime: process.uptime() };
	});

	// Register WebSocket support and routes when a dbManager is provided
	if (options?.dbManager) {
		await server.register(websocket);
		const sessionManager = new SessionManager(options.dbManager);
		await sessionManager.ensureLocalHost();
		await registerWsRoutes(server, sessionManager);
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
