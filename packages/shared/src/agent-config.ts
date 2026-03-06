/** Parsed agent configuration from [agent] section of config.toml */
export interface AgentConfig {
	/** Socket path override (empty = auto-detect per platform) */
	socketPath?: string;
	/** Per-channel output buffer cap in bytes (default 1 MB) */
	bufferPerChannel: number;
	/** Global output buffer cap across all channels in bytes (default 20 MB) */
	bufferGlobal: number;
	/** Log level for agent daemon */
	logLevel: string;
}

/** Default buffer caps */
export const DEFAULT_BUFFER_PER_CHANNEL = 1024 * 1024; // 1 MB
export const DEFAULT_BUFFER_GLOBAL = 20 * 1024 * 1024; // 20 MB

/** Default agent config values */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	bufferPerChannel: DEFAULT_BUFFER_PER_CHANNEL,
	bufferGlobal: DEFAULT_BUFFER_GLOBAL,
	logLevel: "info",
};

/**
 * Parse human-readable size strings like "1MB", "20MB", "512KB" to bytes.
 * Supports: B, KB, MB, GB (case-insensitive).
 * Falls back to parseInt for plain numbers.
 */
export function parseSize(value: string | number): number {
	if (typeof value === "number") return value;

	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
	if (!match || match[1] === undefined) return Number.parseInt(value, 10);

	const num = Number.parseFloat(match[1]);
	const unit = (match[2] ?? "B").toUpperCase();

	const multipliers: Record<string, number> = {
		B: 1,
		KB: 1024,
		MB: 1024 * 1024,
		GB: 1024 * 1024 * 1024,
	};

	return Math.floor(num * (multipliers[unit] ?? 1));
}

/**
 * Parse the [agent] section from a TOML config object.
 * Missing fields get defaults.
 */
export function parseAgentConfig(tomlAgent?: Record<string, unknown>): AgentConfig {
	if (!tomlAgent) return { ...DEFAULT_AGENT_CONFIG };

	return {
		...(tomlAgent.socket_path !== undefined &&
		typeof tomlAgent.socket_path === "string" &&
		tomlAgent.socket_path !== ""
			? { socketPath: tomlAgent.socket_path }
			: {}),
		bufferPerChannel: tomlAgent.buffer_per_channel
			? parseSize(tomlAgent.buffer_per_channel as string | number)
			: DEFAULT_BUFFER_PER_CHANNEL,
		bufferGlobal: tomlAgent.buffer_global
			? parseSize(tomlAgent.buffer_global as string | number)
			: DEFAULT_BUFFER_GLOBAL,
		logLevel: typeof tomlAgent.log_level === "string" ? tomlAgent.log_level : "info",
	};
}
