/**
 * build-version.ts
 *
 * Resolves the build hash at startup:
 *   1. NEXTERM_BUILD_HASH env var (set by CI or SEA esbuild define)
 *   2. `git rev-parse --short HEAD` (dev mode fallback)
 *   3. "dev" (if git is unavailable)
 */

import { execFileSync } from "node:child_process";

function resolveGitHash(): string {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "dev";
	}
}

/**
 * Returns the 7-char build hash for this process.
 * Cached after first call — safe to call repeatedly.
 */
export const BUILD_HASH: string = (() => {
	const env = process.env.NEXTERM_BUILD_HASH;
	if (env && env.length > 0) {
		// Trim to 7 chars in case a full SHA was passed
		return env.slice(0, 7);
	}
	return resolveGitHash();
})();
