import type { AuthPromptResponseMessage } from "@nexterm/shared";
import { isValidUlid } from "@nexterm/shared";
import type { WsHandlerContext } from "./types.js";

export function handleAuthPromptResponse(
	msg: AuthPromptResponseMessage,
	ctx: WsHandlerContext,
): void {
	const { client, clientId, sessionManager } = ctx;

	if (!isValidUlid(msg.hostId)) {
		client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid hostId" });
		return;
	}
	if (msg.secret !== null && (typeof msg.secret !== "string" || msg.secret.length > 4096)) {
		client.send({
			type: "ERROR",
			code: "INVALID_INPUT",
			message: "secret must be a string ≤ 4096 chars or null",
		});
		return;
	}

	sessionManager.handleAuthPromptResponse(clientId, msg.hostId, msg.secret, msg.rememberSession);
}
