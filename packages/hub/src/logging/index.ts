export { ChannelLogger } from "./channel-logger.js";
export { HubLogger } from "./hub-logger.js";
export { runLogGc } from "./log-gc.js";
export type { LogConfig } from "@termora/shared";

export type LoggerRegistry = Map<string, import("./channel-logger.js").ChannelLogger>;

export const LOG_SEVERITY: Record<string, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
};
