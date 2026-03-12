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
 * Build the SUDO_ASKPASS environment for sudo(1) on Linux/macOS.
 * Creates a temporary shell script that reads the secret from the
 * `_NEXTERM_ELEV` environment variable rather than embedding it in
 * shell syntax, preventing command injection via single-quote escape.
 *
 * On Windows this is a no-op — gsudo handles UAC natively.
 *
 * @param secret  The elevation password to pass via environment variable.
 * @param platform  Defaults to process.platform (injected for testing).
 */
export function buildAskpassEnv(
	secret: string,
	platform: NodeJS.Platform = process.platform,
): AskpassResult {
	if (platform === "win32") {
		// gsudo handles UAC natively — no ASKPASS script needed.
		return { env: {}, cleanup: () => {} };
	}

	const randomSuffix = crypto.randomBytes(8).toString("hex");
	const tmpFile = path.join(os.tmpdir(), `nexterm-askpass-${randomSuffix}`);

	// The script reads the secret from an environment variable so the secret
	// never enters shell syntax — preventing single-quote injection attacks.
	fs.writeFileSync(tmpFile, `#!/bin/sh\necho "$_NEXTERM_ELEV"`, { mode: 0o700 });
	// Explicit chmod in case the umask masked the mode bits above.
	fs.chmodSync(tmpFile, 0o700);

	return {
		env: { SUDO_ASKPASS: tmpFile, _NEXTERM_ELEV: secret },
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
 * Wrap a shell command with the platform-appropriate elevation mechanism.
 *
 * Linux/macOS: `sudo -A -E -- <shell> [args]`
 *   -A  use the ASKPASS programme (from SUDO_ASKPASS env)
 *   -E  preserve environment
 *   --  end of sudo options
 *
 * Windows: `gsudo <shell> [args]`
 *   gsudo handles the UAC prompt natively.
 *
 * @param shell     The shell executable (exact path or name).
 * @param args      Arguments for the shell.
 * @param platform  Defaults to process.platform (injected for testing).
 */
export function wrapWithElevation(
	shell: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
): { shell: string; args: string[] } {
	if (platform === "win32") {
		return { shell: "gsudo", args: [shell, ...args] };
	}
	return { shell: "sudo", args: ["-A", "-E", "--", shell, ...args] };
}
