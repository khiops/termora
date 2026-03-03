// Config types and deep merge utility for nexterm config cascade
import { isPlainObject } from "./utils.js";

export interface TerminalProfile {
	fontFamily?: string;
	fontSize?: number;
	theme?: Record<string, string>;
	cursorStyle?: "block" | "underline" | "bar";
	scrollback?: number;
	[key: string]: unknown;
}

export interface PaneLayout {
	direction: "horizontal" | "vertical";
	ratio: number;
	first: PaneLayout | { channelId: string };
	second: PaneLayout | { channelId: string };
}

export interface TabEntry {
	channelId: string;
	label?: string;
	panes?: PaneLayout;
}

export interface TabLayout {
	type: "tabs";
	tabs: TabEntry[];
}

/**
 * Deep merge utility for the config cascade (4 layers, last wins).
 *
 * Rules:
 * - Objects merge recursively
 * - Scalars overwrite
 * - null removes the key
 * - Arrays replace (not merged)
 * - undefined sources are skipped
 */
export function deepMerge<T extends Record<string, unknown>>(
	...sources: (Partial<T> | undefined | null)[]
): T {
	const result: Record<string, unknown> = {};

	for (const source of sources) {
		if (source == null) continue;

		for (const key of Object.keys(source)) {
			const sourceVal = source[key as keyof typeof source];

			if (sourceVal === null) {
				// null removes the key
				delete result[key];
			} else if (
				sourceVal !== undefined &&
				isPlainObject(sourceVal) &&
				isPlainObject(result[key])
			) {
				// Both sides are plain objects — recurse
				result[key] = deepMerge(
					result[key] as Record<string, unknown>,
					sourceVal as Record<string, unknown>,
				);
			} else if (sourceVal !== undefined) {
				// Scalar, array, or new object key — overwrite
				result[key] = sourceVal;
			}
		}
	}

	return result as T;
}
