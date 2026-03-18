// Input validation helpers for protocol messages

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function isValidUlid(id: unknown): id is string {
	return typeof id === "string" && ULID_RE.test(id);
}

export function isValidDimensions(cols: unknown, rows: unknown): boolean {
	return (
		typeof cols === "number" &&
		typeof rows === "number" &&
		Number.isInteger(cols) &&
		Number.isInteger(rows) &&
		cols >= 1 &&
		cols <= 500 &&
		rows >= 1 &&
		rows <= 500
	);
}

export const MAX_INPUT_SIZE = 65_536; // 64 KB

export function isValidInputData(data: unknown): data is Uint8Array {
	return data instanceof Uint8Array && data.byteLength <= MAX_INPUT_SIZE;
}

export const MAX_ENV_COUNT = 256;

export function isValidEnv(env: unknown): env is Record<string, string> | null | undefined {
	if (env == null) return true; // optional
	if (typeof env !== "object" || Array.isArray(env)) return false;
	const entries = Object.entries(env as Record<string, unknown>);
	if (entries.length > MAX_ENV_COUNT) return false;
	return entries.every(
		([k, v]) =>
			typeof k === "string" &&
			typeof v === "string" &&
			k.length <= 256 &&
			(v as string).length <= 8192,
	);
}

// ─── Custom elevation command validation ─────────────────────────────────────

/**
 * Validates a custom elevation command path.
 * Throws a structured error if invalid.
 *
 * Rules:
 * - Must not be empty
 * - Length: 1–4096 characters
 * - ASCII-only (no bytes > 127)
 * - No null bytes
 * - Character allowlist: [a-zA-Z0-9/\\._ :-]
 * - Absolute path: starts with / (Unix) or X:\ (Windows drive letter)
 * - No .. path traversal segments
 */
export function validateCustomCommand(cmd: string): void {
	if (!cmd || cmd.length === 0) {
		throw { code: "INVALID_CUSTOM_COMMAND", message: "custom_command must not be empty" };
	}

	if (cmd.length > 4096) {
		throw { code: "INVALID_CUSTOM_COMMAND", message: "custom_command exceeds maximum length" };
	}

	// ASCII-only check
	for (let i = 0; i < cmd.length; i++) {
		if (cmd.charCodeAt(i) > 127) {
			throw {
				code: "INVALID_CUSTOM_COMMAND",
				message: "custom_command must contain only ASCII characters",
			};
		}
	}

	// Null bytes check (charCode 0)
	if (cmd.includes("\0")) {
		throw { code: "INVALID_CUSTOM_COMMAND", message: "custom_command contains invalid characters" };
	}

	// Character allowlist: a-zA-Z0-9 / \ . _ (space) : -
	const allowlistRegex = /^[a-zA-Z0-9/\\._ :-]+$/;
	if (!allowlistRegex.test(cmd)) {
		throw { code: "INVALID_CUSTOM_COMMAND", message: "custom_command contains invalid characters" };
	}

	// Absolute path check
	const isUnixAbsolute = cmd.startsWith("/");
	const isWindowsAbsolute = /^[A-Za-z]:[/\\]/.test(cmd);
	if (!isUnixAbsolute && !isWindowsAbsolute) {
		throw { code: "INVALID_CUSTOM_COMMAND", message: "custom_command must be an absolute path" };
	}

	// Path traversal check (segment-aware)
	if (/(?:^|[/\\])\.\.[/\\]/.test(cmd) || cmd.endsWith("/..") || cmd.endsWith("\\..")) {
		throw {
			code: "INVALID_CUSTOM_COMMAND",
			message: "custom_command must not contain path traversal",
		};
	}
}
