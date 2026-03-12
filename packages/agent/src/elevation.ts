import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Result of building ASKPASS environment variables.
 * On Linux/macOS this contains the path to a temporary shell script that
 * echoes the elevation secret; on Windows this is a no-op (UAC is handled
 * natively by gsudo).
 */
export interface AskpassResult {
	/** Extra environment variables to merge into the PTY spawn env. */
	env: Record<string, string>;
	/** Remove any temporary files created during setup. */
	cleanup: () => void;
}

/**
 * Check whether the given elevation method can be used without a password
 * on the current system.  Uses spawnSync to probe without spawning a PTY.
 *
 * @param method    The elevation method identifier (e.g. "sudo", "doas").
 * @param platform  The target platform (injected for testing).
 * @returns true if the method can be used passwordlessly.
 */
export function checkPasswordless(
	method: string,
	platform: NodeJS.Platform = process.platform,
): boolean {
	switch (method) {
		case "sudo":
			// sudo -n true exits 0 if the user has a valid passwordless rule.
			return spawnSync("sudo", ["-n", "true"], { timeout: 3000 }).status === 0;
		case "doas":
			// doas -n probe: exits 0 if no password is required.
			return spawnSync("doas", ["-n", "true"], { timeout: 3000 }).status === 0;
		case "pkexec":
			// pkexec always requires an authentication agent interaction.
			return false;
		case "gsudo":
			// gsudo manages its own elevation (UAC prompt or cached token).
			return true;
		case "custom":
			// Custom commands: we have no way to detect — always try.
			return true;
		default:
			return false;
	}
}

/**
 * Build the ASKPASS environment variables for the given elevation method.
 *
 * For sudo: creates a temporary shell script + sets SUDO_ASKPASS + _NEXTERM_ELEV.
 * For doas: creates the same script but sets DOAS_ASKPASS instead.
 * For pkexec/gsudo/custom: no-op (they handle auth differently).
 *
 * The script reads the secret from an environment variable so the secret
 * never enters shell syntax, preventing command injection via quote escaping.
 *
 * @param secret    The elevation password to pass via environment variable.
 * @param method    The elevation method identifier.
 * @param platform  Defaults to process.platform (injected for testing).
 */
export function buildAskpassEnv(
	secret: string,
	method: string,
	platform: NodeJS.Platform = process.platform,
): AskpassResult {
	if (platform === "win32" || method === "pkexec" || method === "gsudo" || method === "custom") {
		// These methods handle auth natively — no ASKPASS script needed.
		return { env: {}, cleanup: () => {} };
	}

	if (method !== "sudo" && method !== "doas") {
		return { env: {}, cleanup: () => {} };
	}

	const randomSuffix = crypto.randomBytes(8).toString("hex");
	const tmpFile = path.join(os.tmpdir(), `nexterm-askpass-${randomSuffix}`);

	// The script reads the secret from an environment variable so the secret
	// never enters shell syntax — preventing single-quote injection attacks.
	fs.writeFileSync(tmpFile, `#!/bin/sh\necho "$_NEXTERM_ELEV"`, { mode: 0o700 });
	// Explicit chmod in case the umask masked the mode bits above.
	fs.chmodSync(tmpFile, 0o700);

	const askpassKey = method === "doas" ? "DOAS_ASKPASS" : "SUDO_ASKPASS";

	return {
		env: { [askpassKey]: tmpFile, _NEXTERM_ELEV: secret },
		cleanup: () => {
			try {
				fs.unlinkSync(tmpFile);
			} catch (err: unknown) {
				// Ignore ENOENT — file may already have been removed.
				if (
					typeof err === "object" &&
					err !== null &&
					(err as NodeJS.ErrnoException).code !== "ENOENT"
				) {
					throw err;
				}
			}
		},
	};
}

/**
 * Wrap a shell command with the appropriate elevation mechanism.
 *
 * method=sudo, mode=askpass:      `sudo -A -H -E -- shell [args]`
 * method=sudo, mode=passwordless: `sudo -n -H -E -- shell [args]`
 * method=doas, mode=askpass:      `doas -- shell [args]`
 * method=doas, mode=passwordless: `doas -n -- shell [args]`
 * method=pkexec:                  `pkexec --disable-internal-agent shell [args]`
 * method=gsudo:                   `gsudo shell [args]`
 * method=custom:                  `<customCommand> -- shell [args]`
 *
 * @param shell          The shell executable (exact path or name).
 * @param args           Arguments for the shell.
 * @param method         The elevation method identifier.
 * @param mode           "askpass" uses an askpass helper; "passwordless" uses -n flag.
 * @param platform       Defaults to process.platform (injected for testing).
 * @param customCommand  Required when method is "custom".
 */
export function wrapWithElevation(
	shell: string,
	args: string[],
	method: string,
	mode: "askpass" | "passwordless",
	platform: NodeJS.Platform = process.platform,
	customCommand?: string,
): { shell: string; args: string[] } {
	switch (method) {
		case "sudo":
			if (mode === "askpass") {
				return { shell: "sudo", args: ["-A", "-H", "-E", "--", shell, ...args] };
			}
			return { shell: "sudo", args: ["-n", "-H", "-E", "--", shell, ...args] };

		case "doas":
			if (mode === "askpass") {
				return { shell: "doas", args: ["--", shell, ...args] };
			}
			return { shell: "doas", args: ["-n", "--", shell, ...args] };

		case "pkexec":
			// pkexec always requires an auth agent — mode is always "askpass" effectively.
			return { shell: "pkexec", args: ["--disable-internal-agent", shell, ...args] };

		case "gsudo":
			return { shell: "gsudo", args: [shell, ...args] };

		case "custom": {
			if (!customCommand) {
				throw new Error("wrapWithElevation: customCommand is required when method is 'custom'");
			}
			return { shell: customCommand, args: ["--", shell, ...args] };
		}

		default:
			// Unknown method — pass through unchanged (safe fallback).
			return { shell, args };
	}
}
