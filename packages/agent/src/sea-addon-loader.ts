/**
 * sea-addon-loader.ts
 *
 * Native addon bootstrap for Node Single Executable Applications (SEA).
 *
 * In SEA mode, .node binary addons are embedded as asset blobs and cannot be
 * loaded directly via require(). This module extracts them to a persistent
 * cache directory and loads them via process.dlopen().
 *
 * In normal Node.js mode (no SEA), this module is a complete no-op.
 *
 * Must be called via initSeaAddons() BEFORE any module that imports node-pty.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Names of .node/.dll assets embedded in the SEA binary. */
const SEA_ADDON_ASSETS: readonly string[] = [
	// winpty files must be extracted BEFORE pty.node (it depends on them)
	...(process.platform === "win32" ? ["winpty.dll", "winpty-agent.exe"] : []),
	"pty.node",
] as const;

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
			? join(process.env["LOCALAPPDATA"] ?? homedir(), "nexterm", "cache")
			: join(process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "nexterm");
	return join(base, "addons", version);
}

/**
 * Extract a single .node asset from the SEA binary to disk.
 * Skips extraction if a file with the correct size already exists (idempotent).
 *
 * @param assetName  - The asset key used in the SEA config (e.g. "pty.node").
 * @param cacheDir   - Target directory (created if absent).
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
 * @param name      - Asset name (e.g. "pty.node").
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
		// Normal Node.js execution — native addons load via standard require().
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
