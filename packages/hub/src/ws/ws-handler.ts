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
import {
	decodeMessage,
	encodeMessage,
	generateId,
	isValidDimensions,
	isValidEnv,
	isValidInputData,
	isValidUlid,
} from "@nexterm/shared";
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
				console.warn(
					`[ws] malformed MessagePack message from client ${clientId} (${raw.byteLength} bytes)`,
				);
				client.send({
					type: "ERROR",
					code: "MALFORMED_MESSAGE",
					message: "Failed to decode MessagePack message",
				});
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
				client.send(sessionManager.getStateSnapshot());
				return;
			}

			switch (msg.type) {
				case "SPAWN": {
					const spawnMsg = msg as UiSpawnMessage;
					if (!isValidUlid(spawnMsg.hostId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid hostId" });
						break;
					}
					if (spawnMsg.cols !== undefined || spawnMsg.rows !== undefined) {
						if (!isValidDimensions(spawnMsg.cols, spawnMsg.rows)) {
							client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid dimensions" });
							break;
						}
					}
					if (
						spawnMsg.shell !== undefined &&
						(typeof spawnMsg.shell !== "string" || spawnMsg.shell.length > 4096)
					) {
						client.send({
							type: "ERROR",
							code: "INVALID_INPUT",
							message: "shell must be a string ≤ 4096 chars",
						});
						break;
					}
					if (
						spawnMsg.cwd !== undefined &&
						(typeof spawnMsg.cwd !== "string" || spawnMsg.cwd.length > 4096)
					) {
						client.send({
							type: "ERROR",
							code: "INVALID_INPUT",
							message: "cwd must be a string ≤ 4096 chars",
						});
						break;
					}
					if (!isValidEnv(spawnMsg.env)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid env" });
						break;
					}
					sessionManager
						.handleSpawn(clientId, spawnMsg)
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
					if (!isValidUlid(attachChannelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
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
					if (!isValidUlid(detachChannelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					writeLockManager.detach(detachChannelId, clientId);
					sessionManager.handleDetach(clientId, detachChannelId);
					break;
				}
				case "INPUT": {
					const inputMsg = msg as InputMessage;
					if (!isValidUlid(inputMsg.channelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					if (!isValidInputData(inputMsg.data)) {
						client.send({
							type: "ERROR",
							code: "INVALID_INPUT",
							message: "Invalid or oversized input data",
						});
						break;
					}
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
					if (!isValidUlid(resizeMsg.channelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					if (!isValidDimensions(resizeMsg.cols, resizeMsg.rows)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid dimensions" });
						break;
					}
					sessionManager.handleResize(
						clientId,
						resizeMsg.channelId,
						resizeMsg.cols,
						resizeMsg.rows,
					);
					break;
				}
				case "WRITE_CLAIM": {
					const claimChannelId = (msg as WriteClaimMessage).channelId;
					if (!isValidUlid(claimChannelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					writeLockManager.claim(claimChannelId, clientId);
					break;
				}
				case "WRITE_RELEASE": {
					const releaseChannelId = (msg as WriteReleaseMessage).channelId;
					if (!isValidUlid(releaseChannelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					writeLockManager.release(releaseChannelId, clientId);
					break;
				}
				case "WRITE_FORCE": {
					const forceChannelId = (msg as WriteForceMessage).channelId;
					if (!isValidUlid(forceChannelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					writeLockManager.force(forceChannelId, clientId);
					break;
				}
				case "WRITE_GRANT": {
					const grantMsg = msg as WriteGrantMessage;
					if (!isValidUlid(grantMsg.channelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
					writeLockManager.grant(grantMsg.channelId, clientId, grantMsg.toClientId);
					break;
				}
				case "WRITE_DENY": {
					// WriteDenyMessage shares the toClientId field shape with WriteGrantMessage
					const denyMsg = msg as WriteDenyMessage;
					if (!isValidUlid(denyMsg.channelId)) {
						client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
						break;
					}
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
