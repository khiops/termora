import type { UiSpawnMessage } from "@nexterm/shared";
import { isValidDimensions, isValidEnv, isValidUlid } from "@nexterm/shared";
import type { WsHandlerContext } from "./types.js";

export function handleSpawn(msg: UiSpawnMessage, ctx: WsHandlerContext): void {
	const { client, clientId, log, sessionManager, writeLockManager } = ctx;

	if (!isValidUlid(msg.hostId)) {
		client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid hostId" });
		return;
	}
	if (msg.cols !== undefined || msg.rows !== undefined) {
		if (!isValidDimensions(msg.cols, msg.rows)) {
			client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid dimensions" });
			return;
		}
	}
	if (msg.shell !== undefined && (typeof msg.shell !== "string" || msg.shell.length > 4096)) {
		client.send({
			type: "ERROR",
			code: "INVALID_INPUT",
			message: "shell must be a string ≤ 4096 chars",
		});
		return;
	}
	if (msg.cwd !== undefined && (typeof msg.cwd !== "string" || msg.cwd.length > 4096)) {
		client.send({
			type: "ERROR",
			code: "INVALID_INPUT",
			message: "cwd must be a string ≤ 4096 chars",
		});
		return;
	}
	if (!isValidEnv(msg.env)) {
		client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid env" });
		return;
	}

	sessionManager
		.handleSpawn(clientId, msg)
		.then((channelId) => {
			if (channelId) {
				writeLockManager.attach(channelId, clientId);
			}
		})
		.catch((err: unknown) => {
			log.error({ err }, "SPAWN handling failed");
		});
}
