import type { DetachMessage } from "@nexterm/shared";
import { isValidUlid } from "@nexterm/shared";
import type { WsHandlerContext } from "./types.js";

export function handleDetach(msg: DetachMessage, ctx: WsHandlerContext): void {
	const { client, clientId, sessionManager, writeLockManager } = ctx;

	if (!isValidUlid(msg.channelId)) {
		client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
		return;
	}

	writeLockManager.detach(msg.channelId, clientId);
	sessionManager.handleDetach(clientId, msg.channelId);
}
