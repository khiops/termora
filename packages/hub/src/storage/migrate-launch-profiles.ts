import { basename } from "node:path";
import type { ConfigResolver } from "../config.js";
import type { MetaDAL } from "./meta.js";

/**
 * Migrate legacy shell defaults (per-host `default_shell` and global config.toml
 * `channels.defaultShell`) into the launch-profiles system.
 *
 * This is an application-level data migration — NOT a SQL migration. It runs after
 * all SQL migrations have been applied and uses the existing DAL to create profiles.
 *
 * Idempotent: if any launch profiles already exist in the DB (from a previous run
 * or from user-created profiles), the function returns immediately with zero counts.
 */
export function migrateLegacyShellDefaults(
	metaDal: MetaDAL,
	configResolver?: ConfigResolver,
): { profilesCreated: number; hostsLinked: number } {
	// ── 1. Idempotency check ─────────────────────────────────────────────────
	if (metaDal.listLaunchProfiles().length > 0) {
		return { profilesCreated: 0, hostsLinked: 0 };
	}

	// Track created profiles: shell path → profile id
	const shellToProfileId = new Map<string, string>();
	// Track used basenames for deduplication
	const usedNames = new Set<string>();
	let profilesCreated = 0;
	let hostsLinked = 0;

	/**
	 * Get or create a launch profile for the given shell path.
	 * Returns the profile id.
	 */
	function getOrCreateProfile(shellPath: string): string {
		const existing = shellToProfileId.get(shellPath);
		if (existing !== undefined) return existing;

		// Compute a deduplicated name for this profile
		const base = basename(shellPath);
		const name = usedNames.has(base) ? shellPath : base;
		usedNames.add(name);

		const profile = metaDal.createLaunchProfile({
			name,
			shell: shellPath,
			mode: "shell",
			elevated: false,
			supportedOs: "any",
			iconType: "auto",
			sortOrder: profilesCreated,
		});

		shellToProfileId.set(shellPath, profile.id);
		profilesCreated++;
		return profile.id;
	}

	// ── 2. Source 1: per-host default_shell ─────────────────────────────────
	const hosts = metaDal.listHosts();

	for (const host of hosts) {
		// Prefer the dedicated default_shell column; fall back to profile_json
		let shellPath: string | undefined = host.defaultShell;

		if (!shellPath && host.profileJson) {
			try {
				const parsed = JSON.parse(host.profileJson) as Record<string, unknown>;
				const candidate = parsed.defaultShell ?? parsed.shell;
				if (typeof candidate === "string" && candidate.length > 0) {
					shellPath = candidate;
				}
			} catch {
				// Malformed profile_json — skip
			}
		}

		if (!shellPath) continue;

		const profileId = getOrCreateProfile(shellPath);

		// Set as the default launch profile for this host
		metaDal.upsertHostProfileOverride(host.id, profileId, "default");
		hostsLinked++;
	}

	// ── 3. Source 2: global config.toml channels.defaultShell ───────────────
	if (configResolver) {
		const globalShell = configResolver.uiConfig.channels.defaultShell;
		if (globalShell && globalShell.length > 0) {
			// Create the profile if it doesn't exist yet (may already exist if a host
			// had the same shell path). No per-host override — just ensure it exists as
			// an available profile.
			if (!shellToProfileId.has(globalShell)) {
				getOrCreateProfile(globalShell);
			}
			// Intentionally no upsertHostProfileOverride here — per spec, the global
			// config.toml defaultShell does NOT get a default override on any specific host.
		}
	}

	return { profilesCreated, hostsLinked };
}
