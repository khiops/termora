// Config types and deep merge utility for nexterm config cascade
import { isPlainObject } from "./utils.js";

export interface TerminalProfile {
	fontFamily?: string;
	fontSize?: number;
	theme?: string;
	themeOverrides?: Record<string, string>;
	cursorStyle?: "block" | "underline" | "bar";
	scrollback?: number;
	bellSound?: boolean;
	/** Show search match markers in the scrollbar overview ruler (default: true). */
	scrollbarMarkers?: boolean;
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
export function deepMerge<T extends object>(...sources: (Partial<T> | undefined | null)[]): T {
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

// ─── UI behavioral config interfaces ─────────────────────────────────────────

export interface TabsConfig {
	/** Whether to show close button on tabs. Default: true */
	closeButton?: boolean;
	/** Where new tabs open: "end" | "afterActive". Default: "end" */
	newTabPosition?: "end" | "afterActive";
	/** Confirm before Close All. Default: true */
	confirmCloseAll?: boolean;
	/** Confirm before Close Others. Default: true */
	confirmCloseOthers?: boolean;
}

export interface PanesConfig {
	/** Max panes per tab. Default: 4 */
	maxPanes?: number;
	/** Default split direction. Default: "horizontal" */
	defaultSplitDirection?: "horizontal" | "vertical";
}

export interface ChannelsConfig {
	/** Default shell for new channels. Default: system shell */
	defaultShell?: string;
}

export interface StartupConfig {
	/** Auto-open welcome tab on host connect. Default: true */
	autoOpenWelcome?: boolean;
}

export interface TitleConfig {
	/** Title source: 'dynamic' uses OSC 0/2, 'static' uses only fallback. Default: 'dynamic'. */
	source?: "dynamic" | "static";
	/** What to show when no dynamic or custom title is set. Default: 'channel'. */
	fallback?: "channel" | "shell" | "custom";
	/** Custom fallback string (used when fallback = 'custom'). */
	fallbackCustom?: string;
	/** Maximum display length for tab titles. Default: 50. */
	maxLength?: number;
	/** Where to place the ellipsis when truncating. Default: 'end'. */
	truncation?: "end" | "middle" | "start";
	/** Per-host title prefix (global default; per-host overrides via host profile). */
	prefix?: string;
	/** Whether to update the browser window/tab title. Default: true. */
	windowTitle?: boolean;
	/** Format string for the browser window title. Default: 'nexterm - {prefix}{host} - {title}'. */
	windowFormat?: string;
}

export interface SearchConfig {
	position?: "top-right" | "bottom-right" | "bottom-bar";
	highlightOnClose?: "clear" | "fade" | "persist";
	scrollbarMarkers?: boolean;
	historySize?: number;
}

export interface HostRailConfig {
	width?: number;
	showLabels?: boolean;
	showStatusDot?: boolean;
}

export interface HostsDefaultsConfig {
	defaultShell?: string;
	keepAliveSeconds?: number;
	historyRetentionDays?: number;
}

// ---------------------------------------------------------------------------
// Notification configuration
// ---------------------------------------------------------------------------

export type ScrollMode = "auto" | "alwaysBottom" | "alwaysResume";
export type BellSound = "system" | "custom" | "mute";

export interface NotificationConfig {
	desktopNotifications?: boolean;
	groupingWindowMs?: number;
	activity?: {
		enabled?: boolean;
		minLines?: number;
		debounceMs?: number;
	};
	bell?: {
		enabled?: boolean;
		sound?: BellSound;
		customSoundFile?: string;
		desktopNotification?: boolean;
	};
	osc9?: {
		enabled?: boolean;
		desktopNotification?: boolean;
	};
	scroll?: {
		mode?: ScrollMode;
		autoThreshold?: number;
	};
}

export const DEFAULT_NOTIFICATION_CONFIG: Required<
	Pick<NotificationConfig, "desktopNotifications" | "groupingWindowMs">
> & {
	activity: Required<NonNullable<NotificationConfig["activity"]>>;
	bell: Required<NonNullable<NotificationConfig["bell"]>>;
	osc9: Required<NonNullable<NotificationConfig["osc9"]>>;
	scroll: Required<NonNullable<NotificationConfig["scroll"]>>;
} = {
	desktopNotifications: true,
	groupingWindowMs: 5000,
	activity: {
		enabled: true,
		minLines: 1,
		debounceMs: 500,
	},
	bell: {
		enabled: true,
		sound: "system",
		customSoundFile: "",
		desktopNotification: true,
	},
	osc9: {
		enabled: true,
		desktopNotification: true,
	},
	scroll: {
		mode: "auto",
		autoThreshold: 100,
	},
};

// ---------------------------------------------------------------------------
// Visual profile types (UX-07)
// ---------------------------------------------------------------------------

export type VisualPreset = "none" | "caution" | "danger" | "custom";
export type BorderStyle = "none" | "subtle" | "strong";

export interface VisualProfile {
	preset: VisualPreset;
	banner: {
		enabled: boolean;
		text: string;
		bgColor: string;
		textColor: string;
	};
	border: {
		style: BorderStyle;
		color: string;
	};
	tint: {
		enabled: boolean;
		color: string;
		opacity: number;
	};
}

/** Layer 1 built-in defaults for the terminal profile cascade. */
export const DEFAULT_PROFILE: TerminalProfile = {
	fontFamily: '"Consolas", "Liberation Mono", "Courier New", monospace',
	fontSize: 14,
	theme: "catppuccin-mocha",
	cursorStyle: "block",
	scrollback: 5000,
	bellSound: false,
	scrollbarMarkers: true,
};
