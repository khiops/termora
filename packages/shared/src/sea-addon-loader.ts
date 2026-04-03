/**
 * sea-addon-loader.ts
 *
 * Shared utilities for native addon bootstrap in Node Single Executable
 * Applications (SEA).
 *
 * In SEA mode, .node binary addons are embedded as asset blobs and cannot be
 * loaded directly via require(). This module provides helpers to detect SEA
 * mode, compute a versioned cache directory, extract blobs to disk, and load
 * them via process.dlopen().
 *
 * In normal Node.js mode (no SEA), detectSea() returns false and the rest is
 * unused.
 *
 * Each package (hub, agent) imports these helpers and supplies its own
 * SEA_ADDON_ASSETS list + initSeaAddons() entry point.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Detect whether we are running inside a Node SEA binary. */
export function detectSea(): boolean {
	try {
		// node:sea is only available in Node 21.7+ / 20.12+
		// In older Node or normal execution, this throws or returns false.
		const req = createRequire(import.meta.url);
		const seaMod = req("node:sea") as { isSea?: () => boolean };
		return typeof seaMod.isSea === "function" && seaMod.isSea();
	} catch {
		return false;
	}
}

/**
 * Returns the persistent cache directory for SEA addon extractions.
 * Uses the package version as a cache-busting path segment so that
 * upgrades always extract fresh binaries.
 */
export function getAddonCacheDir(version: string): string {
	const base =
		platform() === "win32"
			? join(process.env["LOCALAPPDATA"] ?? homedir(), "termora", "cache")
			: join(process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "termora");
	return join(base, "addons", version);
}

/**
 * Extract a single .node asset from the SEA binary to disk.
 * Skips extraction if a file with the correct size already exists (idempotent).
 *
 * @param assetName  - The asset key used in the SEA config (e.g. "better_sqlite3.node").
 * @param cacheDir   - Target directory (created if absent).
 * @param assetData  - Raw bytes of the addon.
 * @returns The absolute path to the extracted .node file.
 */
export function extractAddonToDir(assetName: string, cacheDir: string, assetData: Buffer): string {
	const destPath = join(cacheDir, assetName);

	// Only write if the file doesn't exist or has a different size.
	// We intentionally avoid hash checks for performance — size is sufficient
	// for cache-busting because we version the cache dir.
	let shouldWrite = true;
	if (existsSync(destPath)) {
		try {
			const stat = statSync(destPath);
			if (stat.size === assetData.byteLength) {
				shouldWrite = false;
			}
		} catch {
			// Stat failed — re-extract to be safe.
		}
	}

	if (shouldWrite) {
		mkdirSync(cacheDir, { recursive: true });
		// Write atomically-ish: concurrent processes writing identical bytes
		// is safe — both produce the same valid .node file.
		writeFileSync(destPath, assetData, { mode: 0o755 });
	}

	return destPath;
}

/**
 * Load a native .node addon from an absolute path using process.dlopen().
 * This is equivalent to require('./addon.node') for native modules.
 */
export function dlopenAddon(addonPath: string): void {
	// process.dlopen expects a module-like object and modifies its exports.
	const mod = { exports: {} as Record<string, unknown> };
	process.dlopen(mod, addonPath);
}

/**
 * Load a native addon: extract from SEA assets to cache dir, then dlopen.
 *
 * @param name      - Asset name (e.g. "better_sqlite3.node").
 * @param cacheDir  - Pre-computed cache directory path.
 * @param seaModule - Injected SEA module interface (for testability).
 */
export function loadNativeAddon(
	name: string,
	cacheDir: string,
	seaModule: { getRawAsset: (name: string) => ArrayBuffer },
): void {
	const blob = seaModule.getRawAsset(name);
	const data = Buffer.from(blob);
	const addonPath = extractAddonToDir(name, cacheDir, data);
	dlopenAddon(addonPath);
}
