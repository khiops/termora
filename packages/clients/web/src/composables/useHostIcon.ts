/**
 * Composable for deterministic host badge visuals.
 * Derives initials and a stable background color from a host label,
 * so each host always renders the same badge without any server-side data.
 */

/** Hue values (degrees) for the badge palette — chosen for good contrast on dark backgrounds. */
const HUE_PALETTE = [210, 145, 20, 280, 0, 170, 330, 60, 240, 100] as const;

/**
 * Produce a simple djb2-style hash of a string, returning a non-negative integer.
 */
function hashString(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // keep 32-bit unsigned
	}
	return h;
}

/**
 * Return the first letter of `label` uppercased.
 * Falls back to "?" when the label is empty.
 */
export function getInitials(label: string): string {
	const trimmed = label.trim();
	if (trimmed.length === 0) return "?";
	return (trimmed[0] ?? "?").toUpperCase();
}

/**
 * Return a deterministic HSL CSS color string derived from `label`.
 * Saturation is fixed at 65 %, lightness at 52 % — readable on a dark background
 * without being garish.
 */
export function getColorFromLabel(label: string): string {
	const hue = HUE_PALETTE[hashString(label) % HUE_PALETTE.length] ?? 210;
	return `hsl(${hue}, 65%, 52%)`;
}
