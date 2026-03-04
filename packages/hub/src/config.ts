/**
 * ConfigResolver — implements the 4-layer terminal profile config cascade.
 *
 * Layer 1: DEFAULT_PROFILE (built-in defaults)
 * Layer 2: config.toml [terminal] section (loaded from XDG config dir)
 * Layer 3: host.profile_json (per-host overrides from meta.db)
 * Layer 3.5: agent visual hints (from HELLO message, ephemeral, keyed by sessionId)
 * Layer 4: channel.profile_json (per-channel overrides from meta.db)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { DEFAULT_PROFILE, deepMerge } from "@nexterm/shared";
import type { TerminalProfile } from "@nexterm/shared";
import type { MetaDAL } from "./storage/meta.js";

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

	constructor(private metaDal: MetaDAL) {}

	/**
	 * Load the [terminal] section from config.toml at the given config directory.
	 * Silently no-ops if the file does not exist or has no [terminal] section.
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

		const terminalSection = parsed.terminal;
		if (terminalSection == null || typeof terminalSection !== "object") return;

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
