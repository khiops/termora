const MAX_RAW_LENGTH = 256;

/** Matches C0 (U+0000–U+001F), DEL (U+007F), and C1 (U+0080–U+009F) control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping terminal control chars
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

const ELLIPSIS = "\u2026";

/**
 * Sanitize a terminal title received from OSC 0/2 escape sequences.
 *
 * 1. Strip HTML tags (XSS prevention)
 * 2. Strip control characters U+0000–U+001F and U+007F–U+009F (keep printable + Unicode)
 * 3. Trim surrounding whitespace
 * 4. Truncate to maxRawLength
 */
export function sanitizeTitle(raw: string, maxRawLength = MAX_RAW_LENGTH): string {
	return raw
		.replace(/<[^>]*>/g, "")
		.replace(CONTROL_CHARS_RE, "")
		.trim()
		.slice(0, maxRawLength);
}

export type TruncationPosition = "end" | "middle" | "start";

/**
 * Truncate a title for display in tabs/panes, inserting a single ellipsis
 * character (U+2026) at the configured position.
 *
 * @param title     - The title to truncate
 * @param maxLength - Maximum character length of the result
 * @param position  - Where to place the ellipsis: 'end', 'middle', or 'start'
 */
export function truncateTitle(
	title: string,
	maxLength: number,
	position: TruncationPosition = "end",
): string {
	if (title.length <= maxLength) return title;
	if (maxLength < 1) return "";
	if (maxLength === 1) return ELLIPSIS;

	switch (position) {
		case "end":
			return title.slice(0, maxLength - 1) + ELLIPSIS;

		case "start":
			return ELLIPSIS + title.slice(title.length - (maxLength - 1));

		case "middle": {
			const left = Math.ceil((maxLength - 1) / 2);
			const right = Math.floor((maxLength - 1) / 2);
			return title.slice(0, left) + ELLIPSIS + title.slice(title.length - right);
		}
	}
}
