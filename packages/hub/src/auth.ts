import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AUTH_FILE = "auth.json";

/**
 * Check file permissions on the auth.json.
 * Throws if world-readable (mode & 0o004).
 * Warns if group-readable (mode & 0o040).
 * Skipped on Windows.
 */
export function checkPermissions(authFilePath: string): void {
	if (process.platform === "win32") return;

	const stat = statSync(authFilePath);
	const mode = stat.mode;

	if (mode & 0o004) {
		throw new Error(
			`SECURITY: auth.json at ${authFilePath} is world-readable (mode ${(mode & 0o777).toString(8)}). Fix with: chmod 600 auth.json`,
		);
	}

	if (mode & 0o040) {
		console.warn(
			`[nexterm] WARNING: auth.json at ${authFilePath} is group-readable (mode ${(mode & 0o777).toString(8)}). Recommend: chmod 600 auth.json`,
		);
	}
}

/**
 * Initialize auth: generate token on first run, read on subsequent runs.
 * Writes auth.json with chmod 600 on first run.
 */
export function initAuth(configDir: string): string {
	const authFilePath = join(configDir, AUTH_FILE);

	if (existsSync(authFilePath)) {
		checkPermissions(authFilePath);
		const raw = readFileSync(authFilePath, "utf-8");
		const parsed = JSON.parse(raw) as { token: string };
		return parsed.token;
	}

	// First run — generate and store token
	mkdirSync(configDir, { recursive: true });
	const token = randomBytes(32).toString("hex");
	writeFileSync(authFilePath, JSON.stringify({ token }), { encoding: "utf-8" });
	chmodSync(authFilePath, 0o600);

	return token;
}

/**
 * Constant-time token comparison using crypto.timingSafeEqual.
 * Returns false immediately if lengths differ (avoids timingSafeEqual crash).
 */
export function validateToken(provided: string, expected: string): boolean {
	if (provided.length !== expected.length) return false;

	const a = Buffer.from(provided);
	const b = Buffer.from(expected);

	return timingSafeEqual(a, b);
}
