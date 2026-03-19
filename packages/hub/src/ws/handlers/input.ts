import type { ErrorMessage, InputMessage } from "@nexterm/shared";
import { isValidInputData, isValidUlid } from "@nexterm/shared";
import type { WsHandlerContext } from "./types.js";

export function handleInput(msg: InputMessage, ctx: WsHandlerContext): void {
	const { client, clientId, sessionManager, writeLockManager } = ctx;

	if (!isValidUlid(msg.channelId)) {
		client.send({ type: "ERROR", code: "INVALID_INPUT", message: "Invalid channelId" });
		return;
	}
	if (!isValidInputData(msg.data)) {
		client.send({
			type: "ERROR",
			code: "INVALID_INPUT",
			message: "Invalid or oversized input data",
		});
		return;
	}
	if (!writeLockManager.isHolder(msg.channelId, clientId)) {
		const errMsg: ErrorMessage = {
			type: "ERROR",
			code: "WRITE_LOCK_HELD",
			message: "You do not hold the write lock",
			channelId: msg.channelId,
		};
		client.send(errMsg);
		return;
	}

	sessionManager.handleInput(clientId, msg.channelId, msg.data);
}
