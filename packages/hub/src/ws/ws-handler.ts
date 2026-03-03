import type {
	DetachMessage,
	InputMessage,
	ProtocolMessage,
	ResizeMessage,
	UiAttachMessage,
	UiSpawnMessage,
} from "@nexterm/shared";
import { decodeMessage, encodeMessage, generateId } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import type { SessionManager, WsClient } from "../session/session-manager.js";

export async function registerWsRoutes(
	server: FastifyInstance,
	sessionManager: SessionManager,
): Promise<void> {
	server.get("/ws", { websocket: true }, (socket, _req) => {
		const clientId = generateId();

		const client: WsClient = {
			id: clientId,
			send: (msg: ProtocolMessage) => {
				if (socket.readyState === socket.OPEN) {
					socket.send(encodeMessage(msg));
				}
			},
			attachedChannels: new Set(),
		};

		sessionManager.addClient(client);

		socket.on("message", (raw: Buffer) => {
			let msg: ProtocolMessage;
			try {
				msg = decodeMessage(new Uint8Array(raw));
			} catch {
				// Malformed message — drop silently
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
					sessionManager.handleAttach(clientId, (msg as UiAttachMessage).channelId);
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
			sessionManager.removeClient(clientId);
		});

		socket.on("error", (err: Error) => {
			server.log.error({ err }, "WebSocket error");
			sessionManager.removeClient(clientId);
		});
	});
}
