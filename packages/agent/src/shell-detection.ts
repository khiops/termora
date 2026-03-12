import { constants, access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Expand a single environment variable reference of the form %VAR_NAME% on
 * Windows. Other references are left as-is.
 */
function expandWindowsPath(template: string): string {
	return template.replace(/%([^%]+)%/g, (_, name: string) => {
		const val = process.env[name];
		return val !== undefined ? val : `%${name}%`;
	});
}

/** Return true when the file at `filePath` exists and is executable. */
async function isExecutable(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Cached results — detection runs once per agent process lifetime.
// ---------------------------------------------------------------------------

let _cachedShells: string[] | null = null;
let _cachedDefault: string | null = null;

// ---------------------------------------------------------------------------
// Platform-specific implementations
// ---------------------------------------------------------------------------

async function detectUnix(): Promise<string[]> {
	let lines: string[];
	try {
		const raw = await readFile("/etc/shells", "utf8");
		lines = raw.split("\n");
	} catch {
		return [];
	}

	// Parse: skip comments and blank lines, keep absolute paths.
	const candidates = lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));

	// Filter to paths that exist and are executable.
	const checks = await Promise.all(candidates.map((p) => isExecutable(p)));
	const existing = candidates.filter((_, i) => checks[i]);

	// Deduplicate (preserve first occurrence) and sort.
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const p of existing) {
		if (!seen.has(p)) {
			seen.add(p);
			unique.push(p);
		}
	}
	unique.sort();
	return unique;
}

function getDefaultUnix(): string {
	return process.env.SHELL ?? "/bin/sh";
}

async function detectWindows(): Promise<string[]> {
	const { SYSTEMROOT, ProgramFiles, LOCALAPPDATA } = process.env;
	const programFilesx86 = process.env["ProgramFiles(x86)"];

	const candidates: string[] = [
		`${SYSTEMROOT ?? "%SystemRoot%"}\\System32\\cmd.exe`,
		`${SYSTEMROOT ?? "%SystemRoot%"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
		`${ProgramFiles ?? "%ProgramFiles%"}\\PowerShell\\7\\pwsh.exe`,
		...(programFilesx86 !== undefined ? [`${programFilesx86}\\PowerShell\\7\\pwsh.exe`] : []),
		`${LOCALAPPDATA ?? "%LOCALAPPDATA%"}\\Microsoft\\WindowsApps\\wt.exe`,
		`${ProgramFiles ?? "%ProgramFiles%"}\\Git\\bin\\bash.exe`,
		`${ProgramFiles ?? "%ProgramFiles%"}\\Git\\usr\\bin\\bash.exe`,
	].map(expandWindowsPath);

	const checks = await Promise.all(
		candidates.map(async (p) => {
			// On Windows we check existence, not X_OK (meaningless on NTFS).
			try {
				await access(p, constants.F_OK);
				return true;
			} catch {
				return false;
			}
		}),
	);

	return candidates.filter((_, i) => checks[i]);
}

function getDefaultWindows(): string {
	return process.env.COMSPEC ?? "cmd.exe";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect available shells on the current host.
 *
 * On Linux/macOS: reads /etc/shells, filters to executable paths.
 * On Windows: checks known shell locations.
 *
 * Results are cached after the first call (detection runs once per process).
 * Always returns an array (empty on error).
 */
export async function detectAvailableShells(): Promise<string[]> {
	if (_cachedShells !== null) return _cachedShells;

	const shells = process.platform === "win32" ? await detectWindows() : await detectUnix();

	_cachedShells = shells;
	return shells;
}

/**
 * Return the user's default shell.
 *
 * On Linux/macOS: $SHELL or /bin/sh.
 * On Windows: %COMSPEC% or cmd.exe.
 *
 * Result is cached after the first call.
 * Always returns a non-empty string.
 */
export function getDefaultShell(): string {
	if (_cachedDefault !== null) return _cachedDefault;

	const shell = process.platform === "win32" ? getDefaultWindows() : getDefaultUnix();

	_cachedDefault = shell;
	return shell;
}

/** Reset cached results (for testing). */
export function _resetShellCache(): void {
	_cachedShells = null;
	_cachedDefault = null;
}

/**
 * Resolve the absolute path to a shell executable.
 * Used internally to build full paths (no-op if already absolute).
 */
export function _resolveShellPath(p: string): string {
	return resolve(p);
}
