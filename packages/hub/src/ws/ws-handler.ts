import type {
	AuthMessage,
	DetachMessage,
	InputMessage,
	ProtocolMessage,
	ResizeMessage,
	UiAttachMessage,
	UiSpawnMessage,
} from "@nexterm/shared";
import { decodeMessage, encodeMessage, generateId } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import { validateToken } from "../auth.js";
import type { SessionManager, WsClient } from "../session/session-manager.js";

export async function registerWsRoutes(
	server: FastifyInstance,
	sessionManager: SessionManager,
	authToken?: string,
): Promise<void> {
	server.get("/ws", { websocket: true }, (socket, _req) => {
		const clientId = generateId();
		let authenticated = !authToken; // skip auth gate when no token configured

		const client: WsClient = {
			id: clientId,
			send: (msg: ProtocolMessage) => {
				if (socket.readyState === socket.OPEN) {
					socket.send(encodeMessage(msg));
				}
			},
			attachedChannels: new Set(),
		};

		// Only register the client after successful AUTH (or when auth is disabled)
		if (!authToken) {
			sessionManager.addClient(client);
		}

		socket.on("message", (raw: Buffer) => {
			let msg: ProtocolMessage;
			try {
				msg = decodeMessage(new Uint8Array(raw));
			} catch {
				// Malformed message — drop silently
				return;
			}

			// AUTH handshake — must be the first message when auth is enabled
			if (!authenticated) {
				if (msg.type !== "AUTH") {
					server.log.warn({ clientId }, "ws-auth: first message must be AUTH");
					client.send({ type: "AUTH_FAIL", message: "First message must be AUTH" });
					socket.close();
					return;
				}

				const authMsg = msg as AuthMessage;
				if (!validateToken(authMsg.token, authToken as string)) {
					server.log.warn({ clientId }, "ws-auth: invalid token");
					client.send({ type: "AUTH_FAIL", message: "Invalid token" });
					socket.close();
					return;
				}

				authenticated = true;
				sessionManager.addClient(client);
				server.log.info({ clientId }, "ws-auth: accepted");
				client.send({ type: "AUTH_OK", clientId });
				return;
			}

			switch (msg.type) {
				case "SPAWN": {
					sessionManager.handleSpawn(clientId, msg as UiSpawnMessage).catch((err: unknown) => {
						server.log.error({ err }, "SPAWN handling failed");
					});
					break;
				}
				case "ATTACH": {
					sessionManager
						.handleAttach(clientId, (msg as UiAttachMessage).channelId)
						.catch((err: unknown) => {
							server.log.error({ err }, "ATTACH handling failed");
						});
					break;
				}
				case "DETACH": {
					sessionManager.handleDetach(clientId, (msg as DetachMessage).channelId);
					break;
				}
				case "INPUT": {
					const inputMsg = msg as InputMessage;
					sessionManager.handleInput(clientId, inputMsg.channelId, inputMsg.data);
					break;
				}
				case "RESIZE": {
					const resizeMsg = msg as ResizeMessage;
					sessionManager.handleResize(
						clientId,
						resizeMsg.channelId,
						resizeMsg.cols,
						resizeMsg.rows,
					);
					break;
				}
				case "PING": {
					client.send({ type: "PONG" });
					break;
				}
				default:
					break;
			}
		});

		socket.on("close", () => {
			if (authenticated) {
				sessionManager.removeClient(clientId);
			}
		});

		socket.on("error", (err: Error) => {
			server.log.error({ err }, "WebSocket error");
			if (authenticated) {
				sessionManager.removeClient(clientId);
			}
		});
	});
}
