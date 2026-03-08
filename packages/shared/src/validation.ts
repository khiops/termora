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
