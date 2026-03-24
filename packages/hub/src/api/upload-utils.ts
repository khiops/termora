import { basename } from "node:path";

/**
 * Strip directory components and reject names with traversal sequences.
 * Returns null for any invalid filename.
 */
export function sanitizeFilename(raw: string): string | null {
	const name = basename(raw);
	if (name !== raw || name.includes("..") || name.includes("/") || name.includes("\\")) {
		return null;
	}
	if (!name || name === "." || name === "..") {
		return null;
	}
	return name;
}
