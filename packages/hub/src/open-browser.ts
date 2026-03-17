/**
 * open-browser.ts
 *
 * Cross-platform helper to open a URL in the default browser.
 * Uses child_process.execFile with a hardcoded binary path so the URL
 * is passed as a separate argument, preventing shell injection.
 * Fire-and-forget: does not wait for the browser to exit.
 */

import { execFile } from "node:child_process";

/**
 * Resolve the platform-specific browser-open binary and its arguments.
 * Exported for unit testing without spawning a real process.
 */
export function buildOpenArgs(url: string): { bin: string; args: string[] } {
	// Guard: only allow http/https URLs
	if (!/^https?:\/\//i.test(url)) {
		throw new Error(`openBrowser: unsafe URL scheme: ${url}`);
	}

	switch (process.platform) {
		case "darwin":
			return { bin: "open", args: [url] };
		case "win32":
			// cmd.exe /c start handles the URL; /c exits after start completes
			return { bin: "cmd.exe", args: ["/c", "start", "", url] };
		default:
			// Linux + BSDs
			return { bin: "xdg-open", args: [url] };
	}
}

/**
 * Open `url` in the system's default browser.
 *
 * - macOS  : `open <url>`
 * - Windows: `cmd.exe /c start "" <url>`
 * - Linux  : `xdg-open <url>`
 *
 * Errors are silently swallowed — browser open is best-effort.
 */
export function openBrowser(url: string): void {
	const { bin, args } = buildOpenArgs(url);
	execFile(bin, args, (_err) => {
		// Fire-and-forget; ignore errors (e.g. no desktop env in headless CI)
	});
}
