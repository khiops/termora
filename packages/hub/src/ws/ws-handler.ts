import type {
	AuthMessage,
	DetachMessage,
	ErrorMessage,
	InputMessage,
	ProtocolMessage,
	ResizeMessage,
	UiAttachMessage,
	UiSpawnMessage,
	WriteClaimMessage,
	WriteDenyMessage,
	WriteForceMessage,
	WriteGrantMessage,
	WriteReleaseMessage,
} from "@nexterm/shared";
import { decodeMessage, encodeMessage, generateId } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import { validateToken } from "../auth.js";
import type { SessionManager, WsClient } from "../session/session-manager.js";
import { WriteLockManager } from "../session/write-lock.js";

export async function registerWsRoutes(
	server: FastifyInstance,
	sessionManager: SessionManager,
	authToken?: string,
): Promise<void> {
	// Registry: clientId → send function.
	// WriteLockManager needs to send to arbitrary clients (not just those on a given
	// channel) for WRITE_REQUEST / WRITE_DENY / WRITE_REVOKED. The registry is
	// populated on connect and cleaned up on disconnect.
	const clientSendRegistry = new Map<string, (msg: ProtocolMessage) => void>();

	const writeLockManager = new WriteLockManager({
		sendToClient: (clientId, msg) => {
			clientSendRegistry.get(clientId)?.(msg as ProtocolMessage);
		},
		broadcastToChannel: (channelId, msg) => {
			for (const client of sessionManager.getClientsForChannel(channelId)) {
				client.send(msg as ProtocolMessage);
			}
		},
	});

	// Provide write-lock holder lookup so ATTACH_OK includes the current holder
	sessionManager.setGetWriteLockHolder((channelId) => writeLockManager.getHolder(channelId));

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

		// Register send function for write-lock targeted messages
		clientSendRegistry.set(clientId, client.send);

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
					sessionManager
						.handleSpawn(clientId, msg as UiSpawnMessage)
						.then((channelId) => {
							if (channelId) {
								writeLockManager.attach(channelId, clientId);
							}
						})
						.catch((err: unknown) => {
							server.log.error({ err }, "SPAWN handling failed");
						});
					break;
				}
				case "ATTACH": {
					const attachChannelId = (msg as UiAttachMessage).channelId;
					sessionManager
						.handleAttach(clientId, attachChannelId)
						.then((ok) => {
							if (ok) {
								writeLockManager.attach(attachChannelId, clientId);
							}
						})
						.catch((err: unknown) => {
							server.log.error({ err }, "ATTACH handling failed");
						});
					break;
				}
				case "DETACH": {
					const detachChannelId = (msg as DetachMessage).channelId;
					writeLockManager.detach(detachChannelId, clientId);
					sessionManager.handleDetach(clientId, detachChannelId);
					break;
				}
				case "INPUT": {
					const inputMsg = msg as InputMessage;
					if (!writeLockManager.isHolder(inputMsg.channelId, clientId)) {
						const errMsg: ErrorMessage = {
							type: "ERROR",
							code: "WRITE_LOCK_HELD",
							message: "You do not hold the write lock",
							channelId: inputMsg.channelId,
						};
						client.send(errMsg);
						break;
					}
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
				case "WRITE_CLAIM": {
					writeLockManager.claim((msg as WriteClaimMessage).channelId, clientId);
					break;
				}
				case "WRITE_RELEASE": {
					writeLockManager.release((msg as WriteReleaseMessage).channelId, clientId);
					break;
				}
				case "WRITE_FORCE": {
					writeLockManager.force((msg as WriteForceMessage).channelId, clientId);
					break;
				}
				case "WRITE_GRANT": {
					const grantMsg = msg as WriteGrantMessage;
					writeLockManager.grant(grantMsg.channelId, clientId, grantMsg.toClientId);
					break;
				}
				case "WRITE_DENY": {
					// WriteDenyMessage shares the toClientId field shape with WriteGrantMessage
					const denyMsg = msg as WriteDenyMessage;
					writeLockManager.deny(denyMsg.channelId, clientId, denyMsg.toClientId);
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
			clientSendRegistry.delete(clientId);
			if (authenticated) {
				writeLockManager.onClientDisconnect(clientId);
				sessionManager.removeClient(clientId);
			}
		});

		socket.on("error", (err: Error) => {
			server.log.error({ err }, "WebSocket error");
			clientSendRegistry.delete(clientId);
			if (authenticated) {
				writeLockManager.onClientDisconnect(clientId);
				sessionManager.removeClient(clientId);
			}
		});
	});
}
