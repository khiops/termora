/**
 * ConfigResolver — implements the 4-layer terminal profile config cascade.
 *
 * Layer 1: DEFAULT_PROFILE (built-in defaults)
 * Layer 2: config.toml [terminal] section (loaded from XDG config dir)
 * Layer 3: host.profile_json (per-host overrides from meta.db)
 * Layer 3.5: agent visual hints (from HELLO message, ephemeral, keyed by sessionId)
 * Layer 4: channel.profile_json (per-channel overrides from meta.db)
 *
 * Also parses the [gc] section for spool garbage collector configuration.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { DEFAULT_PROFILE, deepMerge } from "@nexterm/shared";
import type { TerminalProfile } from "@nexterm/shared";
import type { MetaDAL } from "./storage/meta.js";

// ─── GC configuration ──────────────────────────────────────────────────────────

/** Spool garbage collector configuration (from [gc] in config.toml). */
export interface GcConfig {
	/** Hours before dead channel spool data is purged (0 = immediate). Default: 24. */
	deadRetentionHours: number;
	/** Max spool size per channel in MB. Default: 10. */
	maxSizePerChannelMb: number;
}

export const DEFAULT_GC_CONFIG: GcConfig = {
	deadRetentionHours: 24,
	maxSizePerChannelMb: 10,
};

/**
 * Extract GcConfig from a parsed TOML map's [gc] section.
 * Returns a new GcConfig with defaults overridden by any valid values found.
 */
function extractGcConfig(parsed: TOML.JsonMap): GcConfig {
	const config: GcConfig = { ...DEFAULT_GC_CONFIG };
	const gcSection = parsed.gc;
	if (gcSection != null && typeof gcSection === "object") {
		const gcRaw = gcSection as Record<string, unknown>;
		if (typeof gcRaw.dead_retention_hours === "number") {
			config.deadRetentionHours = Math.max(0, gcRaw.dead_retention_hours);
		}
		if (typeof gcRaw.max_size_per_channel_mb === "number") {
			config.maxSizePerChannelMb = Math.max(0, gcRaw.max_size_per_channel_mb);
		}
	}
	return config;
}

/**
 * Standalone loader: parse the [gc] section from config.toml and return a GcConfig.
 * Returns defaults if the file is missing, malformed, or has no [gc] section.
 * Used by server.ts to provide GC config before SessionManager is created.
 */
export function loadGcConfig(configDir: string): GcConfig {
	const configPath = join(configDir, "config.toml");
	if (!existsSync(configPath)) return { ...DEFAULT_GC_CONFIG };

	try {
		const content = readFileSync(configPath, "utf8");
		return extractGcConfig(TOML.parse(content));
	} catch {
		return { ...DEFAULT_GC_CONFIG };
	}
}

// ─── UI configuration ───────────────────────────────────────────────────────

/** UI behavioral configuration (from [ui] in config.toml). */
export interface UiConfig {
	/** What to do when a channel dies: "close" the tab or keep it "readonly". Default: "close". */
	onChannelDead: "close" | "readonly";
}

export const DEFAULT_UI_CONFIG: UiConfig = {
	onChannelDead: "close",
};

/**
 * Extract UiConfig from a parsed TOML map's [ui] section.
 * Returns a new UiConfig with defaults overridden by any valid values found.
 */
export function extractUiConfig(parsed: TOML.JsonMap): UiConfig {
	const config: UiConfig = { ...DEFAULT_UI_CONFIG };
	const uiSection = parsed.ui;
	if (uiSection != null && typeof uiSection === "object") {
		const uiRaw = uiSection as Record<string, unknown>;
		if (
			typeof uiRaw.on_channel_dead === "string" &&
			(uiRaw.on_channel_dead === "close" || uiRaw.on_channel_dead === "readonly")
		) {
			config.onChannelDead = uiRaw.on_channel_dead;
		}
	}
	return config;
}

/**
 * Standalone loader: parse the [ui] section from config.toml and return a UiConfig.
 * Returns defaults if the file is missing, malformed, or has no [ui] section.
 */
export function loadUiConfig(configDir: string): UiConfig {
	const configPath = join(configDir, "config.toml");
	if (!existsSync(configPath)) return { ...DEFAULT_UI_CONFIG };

	try {
		const content = readFileSync(configPath, "utf8");
		return extractUiConfig(TOML.parse(content));
	} catch {
		return { ...DEFAULT_UI_CONFIG };
	}
}

// ─── TOML snake_case → camelCase ─────────────────────────────────────────────

/**
 * Convert a snake_case TOML key to camelCase.
 * Only shallow keys in the [terminal] section need conversion.
 */
function snakeToCamel(s: string): string {
	return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Convert a flat object with snake_case keys (from TOML) to camelCase.
 * Nested objects (e.g. theme_overrides) are handled by remapping the key
 * and preserving the object value as-is.
 */
function tomlSectionToProfile(section: Record<string, unknown>): Partial<TerminalProfile> {
	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(section)) {
		result[snakeToCamel(key)] = val;
	}
	return result as Partial<TerminalProfile>;
}

// ─── ConfigResolver ──────────────────────────────────────────────────────────

export class ConfigResolver {
	private fileConfig: Partial<TerminalProfile> | null = null;
	private agentHints = new Map<string, Partial<TerminalProfile>>();
	private _gcConfig: GcConfig = { ...DEFAULT_GC_CONFIG };
	private _uiConfig: UiConfig = { ...DEFAULT_UI_CONFIG };

	constructor(private metaDal: MetaDAL) {}

	/** Returns the resolved GC configuration (defaults merged with [gc] from config.toml). */
	get gcConfig(): GcConfig {
		return this._gcConfig;
	}

	/** Returns the resolved UI configuration (defaults merged with [ui] from config.toml). */
	get uiConfig(): UiConfig {
		return this._uiConfig;
	}

	/**
	 * Load [terminal], [gc], and [ui] sections from config.toml at the given config directory.
	 * Silently no-ops if the file does not exist or is malformed.
	 */
	loadFromFile(configDir: string): void {
		const configPath = join(configDir, "config.toml");
		if (!existsSync(configPath)) return;

		let parsed: TOML.JsonMap;
		try {
			const content = readFileSync(configPath, "utf8");
			parsed = TOML.parse(content);
		} catch {
			// Malformed TOML — skip silently (do not crash the hub)
			return;
		}

		// ── [terminal] section ──────────────────────────────────────────────
		const terminalSection = parsed.terminal;
		if (terminalSection != null && typeof terminalSection === "object") {
			// Separate nested theme_overrides from flat keys
			const flat: Record<string, unknown> = {};
			for (const [key, val] of Object.entries(terminalSection as Record<string, unknown>)) {
				if (key === "theme_overrides" && val !== null && typeof val === "object") {
					flat.themeOverrides = val as Record<string, string>;
				} else {
					flat[snakeToCamel(key)] = val;
				}
			}

			this.fileConfig = flat as Partial<TerminalProfile>;
		}

		// ── [gc] section ────────────────────────────────────────────────────
		this._gcConfig = extractGcConfig(parsed);

		// ── [ui] section ────────────────────────────────────────────────────
		this._uiConfig = extractUiConfig(parsed);
	}

	/**
	 * Store ephemeral visual hints sent by an agent in its HELLO message.
	 * Keyed by sessionId — replaced entirely on each HELLO.
	 */
	setAgentHints(sessionId: string, hints: Partial<TerminalProfile>): void {
		this.agentHints.set(sessionId, hints);
	}

	/**
	 * Remove agent hints for a session (call on session close).
	 */
	clearAgentHints(sessionId: string): void {
		this.agentHints.delete(sessionId);
	}

	/**
	 * Resolve the fully-merged terminal profile for a given host/channel context.
	 *
	 * Layer order (last wins):
	 *   1. DEFAULT_PROFILE
	 *   2. fileConfig (config.toml)
	 *   3. host profile_json
	 *   3.5. agent hints (session for the host, if known)
	 *   4. channel profile_json
	 */
	resolve(hostId?: string, channelId?: string, sessionId?: string): TerminalProfile {
		// Layer 1 — defaults
		let profile: TerminalProfile = deepMerge(DEFAULT_PROFILE);

		// Layer 2 — config.toml
		if (this.fileConfig) {
			profile = deepMerge(profile, this.fileConfig);
		}

		// Layer 3 — host profile_json
		if (hostId) {
			const hostProfileRaw = this.metaDal.getHostProfile(hostId);
			if (hostProfileRaw) {
				try {
					const hostProfile = JSON.parse(hostProfileRaw) as Partial<TerminalProfile>;
					profile = deepMerge(profile, hostProfile);
				} catch {
					// Invalid JSON — skip
				}
			}
		}

		// Layer 3.5 — agent hints
		if (sessionId) {
			const hints = this.agentHints.get(sessionId);
			if (hints) {
				profile = deepMerge(profile, hints);
			}
		}

		// Layer 4 — channel profile_json
		if (channelId) {
			const channelProfileRaw = this.metaDal.getChannelProfile(channelId);
			if (channelProfileRaw) {
				try {
					const channelProfile = JSON.parse(channelProfileRaw) as Partial<TerminalProfile>;
					profile = deepMerge(profile, channelProfile);
				} catch {
					// Invalid JSON — skip
				}
			}
		}

		return profile;
	}
}
