import type { ProtocolMessage } from "@nexterm/shared";
import type { WsHandlerContext } from "./types.js";

export function handlePing(_msg: ProtocolMessage, ctx: WsHandlerContext): void {
	ctx.client.send({ type: "PONG" });
}
