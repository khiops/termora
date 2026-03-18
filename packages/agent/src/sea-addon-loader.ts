/**
 * sea-addon-loader.ts — agent
 *
 * Native addon bootstrap for Node Single Executable Applications (SEA).
 * Agent-specific entry point: lists the addons embedded in the agent SEA
 * binary (node-pty + winpty on Windows) and calls initSeaAddons() once at
 * startup.
 *
 * Shared helpers (detectSea, getAddonCacheDir, extractAddonToDir, dlopenAddon,
 * loadNativeAddon) live in @nexterm/shared.
 *
 * Must be called via initSeaAddons() BEFORE any module that imports node-pty.
 */

import { createRequire } from "node:module";
import {
	detectSea,
	extractAddonToDir,
	getAddonCacheDir,
	loadNativeAddon,
} from "@nexterm/shared";

// Re-export shared helpers so existing callers/tests that import from this
// file continue to work unchanged.
export {
	detectSea,
	dlopenAddon,
	extractAddonToDir,
	getAddonCacheDir,
	loadNativeAddon,
} from "@nexterm/shared";

/** Names of .node/.dll assets embedded in the agent SEA binary. */
const SEA_ADDON_ASSETS: readonly string[] = [
	// winpty files must be extracted BEFORE pty.node (it depends on them)
	...(process.platform === "win32" ? ["winpty.dll", "winpty-agent.exe"] : []),
	"pty.node",
] as const;

/**
 * Called once at agent startup (before any native module imports).
 *
 * In SEA mode: extracts all embedded .node addons to the cache dir and
 * pre-loads them so subsequent require('node-pty') calls resolve correctly.
 *
 * In normal Node.js mode: complete no-op.
 */
export function initSeaAddons(): void {
	if (!detectSea()) {
		// Normal Node.js execution — native addons load via standard require()
		return;
	}

	const req = createRequire(import.meta.url);
	const seaMod = req("node:sea") as {
		getRawAsset: (name: string) => ArrayBuffer;
		getAsset?: (name: string, encoding: BufferEncoding) => string;
	};

	// Read the package version from SEA asset manifest (injected at build time).
	// Fall back to "0.0.0" if not present so we don't crash startup.
	let version = "0.0.0";
	try {
		if (typeof seaMod.getAsset === "function") {
			version = seaMod.getAsset("VERSION", "utf8").trim();
		}
	} catch {
		// Non-fatal: use default version.
	}

	const cacheDir = getAddonCacheDir(version);

	for (const assetName of SEA_ADDON_ASSETS) {
		try {
			if (assetName.endsWith(".node")) {
				loadNativeAddon(assetName, cacheDir, seaMod);
			} else {
				// DLLs and executables: just extract to cache dir (no dlopen).
				// Windows finds them automatically when they are co-located with
				// the .node file that depends on them.
				const blob = seaMod.getRawAsset(assetName);
				const data = Buffer.from(blob);
				extractAddonToDir(assetName, cacheDir, data);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (assetName === "pty.node") {
				// Extraction or dlopen failure is fatal — the agent cannot
				// function without PTY support.
				process.stderr.write(
					`[nexterm-agent] fatal: failed to load SEA addon '${assetName}': ${msg}\n`,
				);
				process.exit(1);
			}
			// winpty.dll / winpty-agent.exe: warn but continue.
			// On non-Windows builds the assets won't be embedded — this is expected.
			process.stderr.write(
				`[nexterm-agent] warn: SEA addon '${assetName}' not available: ${msg}\n`,
			);
		}
	}
}
