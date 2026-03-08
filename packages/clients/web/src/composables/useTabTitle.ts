import { DEFAULT_CHANNEL_NAME, truncateTitle } from "@nexterm/shared";
import type { Channel, TitleConfig, TruncationPosition } from "@nexterm/shared";
import { type ComputedRef, type Ref, computed } from "vue";

const DEFAULT_MAX_TITLE_LENGTH = 50;
const DEFAULT_TRUNCATION_POSITION: TruncationPosition = "end";

export interface TabTitleOptions {
	/** Maximum display length before truncation (default: 50) */
	maxLength?: number;
	/** Where to place the ellipsis when truncating (default: 'end') */
	truncationPosition?: TruncationPosition;
	/**
	 * Per-host prefix to prepend to the tab title (e.g. "PROD ").
	 * Applied AFTER title resolution but BEFORE truncation, so the prefix
	 * counts toward the character limit.
	 * Per SC-15, prefix is for tab title and window title only — NOT sidebar.
	 */
	prefix?: Ref<string>;
	/**
	 * Title settings from TitleConfig (loaded from config store).
	 * When provided, overrides maxLength, truncationPosition, and controls
	 * source/fallback behavior.
	 */
	titleConfig?: TitleConfig;
}

/**
 * Resolve the display title for a channel tab/pane/sidebar entry.
 *
 * Title priority (INV-01):
 *   1. Custom title (from F2 rename) — `channel.title` explicitly set by user
 *   2. Dynamic title (from OSC 0/2) — `liveDynamicTitle` (real-time) or `channel.dynamicTitle` (persisted)
 *   3. Fallback — DEFAULT_CHANNEL_NAME ("Terminal")
 *
 * The resolved title is truncated to `options.maxLength` (default 50) using
 * `truncateTitle` with a single ellipsis (U+2026) at the configured position.
 *
 * Options (maxLength, truncationPosition, titleConfig) are read at setup time
 * and are NOT reactive. Use `prefix` (a Ref) for reactive per-host prefix changes.
 *
 * @param channelId - Reactive channel ID (null when no channel is selected)
 * @param channels - Reactive channel list (from channels store)
 * @param liveDynamicTitle - Optional reactive title from xterm.js onTitleChange (active pane only)
 * @param options - Optional truncation configuration
 */
export function useTabTitle(
	channelId: Ref<string | null>,
	channels: Ref<readonly Channel[]>,
	liveDynamicTitle?: Ref<string | null>,
	options?: TabTitleOptions,
): {
	/** Fully resolved title with prefix and truncation applied. For tabs/panes. */
	tabTitle: ComputedRef<string>;
	/** Raw resolved title WITHOUT prefix or truncation. For window title composition. */
	resolvedTitle: ComputedRef<string>;
	isCustom: ComputedRef<boolean>;
	isDynamic: ComputedRef<boolean>;
} {
	const cfg = options?.titleConfig;
	const maxLength = cfg?.maxLength ?? options?.maxLength ?? DEFAULT_MAX_TITLE_LENGTH;
	const position =
		(cfg?.truncation as TruncationPosition | undefined) ??
		options?.truncationPosition ??
		DEFAULT_TRUNCATION_POSITION;
	const source = cfg?.source ?? "dynamic";
	const fallbackMode = cfg?.fallback ?? "channel";
	const fallbackCustom = cfg?.fallbackCustom ?? "";

	const channel = computed(() => {
		const id = channelId.value;
		if (id === null) return null;
		return channels.value.find((c) => c.id === id) ?? null;
	});

	const isCustom = computed(() => {
		const ch = channel.value;
		return ch?.title != null && ch.title !== "";
	});

	const isDynamic = computed(() => {
		if (isCustom.value) return false;
		if (source === "static") return false;
		const live = liveDynamicTitle?.value;
		if (live != null && live !== "") return true;
		const ch = channel.value;
		return ch?.dynamicTitle != null && ch.dynamicTitle !== "";
	});

	/** Resolve the fallback title based on the configured fallback mode. */
	function resolveFallback(ch: Channel): string {
		switch (fallbackMode) {
			case "shell":
				return ch.shell || DEFAULT_CHANNEL_NAME;
			case "custom":
				return fallbackCustom || DEFAULT_CHANNEL_NAME;
			default:
				return DEFAULT_CHANNEL_NAME;
		}
	}

	const resolvedTitle = computed(() => {
		const ch = channel.value;
		if (ch === null) return DEFAULT_CHANNEL_NAME;

		// Priority 1: Custom title (SC-03) — always honored regardless of source
		if (ch.title != null && ch.title !== "") return ch.title;

		// Priority 2: Dynamic title (only when source = 'dynamic')
		if (source === "dynamic") {
			const live = liveDynamicTitle?.value;
			if (live != null && live !== "") return live;
			if (ch.dynamicTitle != null && ch.dynamicTitle !== "") return ch.dynamicTitle;
		}

		// Priority 3: Fallback
		return resolveFallback(ch);
	});

	const tabTitle = computed(() => {
		const prefix = options?.prefix?.value ?? "";
		const prefixed = prefix + resolvedTitle.value;
		return truncateTitle(prefixed, maxLength, position);
	});

	return { tabTitle, resolvedTitle, isCustom, isDynamic };
}
