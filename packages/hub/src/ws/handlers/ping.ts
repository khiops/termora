import type { ProtocolMessage } from "@termora/shared";
import type { WsHandlerContext } from "./types.js";

export function handlePing(_msg: ProtocolMessage, ctx: WsHandlerContext): void {
	ctx.client.send({ type: "PONG" });
}
