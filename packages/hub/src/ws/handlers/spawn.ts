import type { UiSpawnMessage } from "@nexterm/shared";
import { isValidDimensions, isValidEnv, isValidUlid, validateShell } from "@nexterm/shared";
import type { WsHandlerContext } from "./types.js";

export function handleSpawn(msg: UiSpawnMessage, ctx: WsHandlerContext): void {
	const { client, clientId, log, sessionManager, writeLockManager } = ctx;

	console.log(
		`[spawn-handler] received SPAWN: hostId=${msg.hostId} clientId=${clientId} shell=${msg.shell} cols=${msg.cols} rows=${msg.rows}`,
	);

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
	const shellError = validateShell(msg.shell);
	if (shellError !== null) {
		client.send({ type: "ERROR", code: "INVALID_INPUT", message: shellError });
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

	console.log(`[spawn-handler] validation passed, calling sessionManager.handleSpawn`);
	sessionManager
		.handleSpawn(clientId, msg)
		.then((channelId) => {
			console.log(`[spawn-handler] sessionManager.handleSpawn returned channelId=${channelId}`);
			if (channelId) {
				writeLockManager.attach(channelId, clientId);
			}
		})
		.catch((err: unknown) => {
			console.log(
				`[spawn-handler] sessionManager.handleSpawn THREW: ${err instanceof Error ? err.stack : String(err)}`,
			);
			log.error({ err }, "SPAWN handling failed");
		});
}
