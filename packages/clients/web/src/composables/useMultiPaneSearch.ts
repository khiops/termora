import type { InjectionKey } from "vue";
import { type Ref, computed, ref, shallowRef } from "vue";
import type { PaneNode } from "./useLayout.js";
import { collectTerminalChannelIds } from "./useLayout.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchScope = "pane" | "all";

/**
 * Per-pane search handle registered by each TerminalPane.
 * Exposes the SearchAddon wrappers needed for cross-pane orchestration.
 */
export interface PaneSearchHandle {
	channelId: string;
	/** Trigger an incremental search on this pane. Returns the match count. */
	search: (query: string) => void;
	findNext: () => void;
	findPrevious: () => void;
	clear: () => void;
	matchCount: Ref<number>;
	currentMatch: Ref<number>;
}

/**
 * Multi-pane search registry — provided at the App/layout level,
 * injected by each TerminalPane to register/unregister its search handle.
 */
export interface MultiPaneSearchRegistry {
	/** Register a pane's search handle. Call on mount. */
	register: (handle: PaneSearchHandle) => void;
	/** Unregister a pane's search handle. Call on unmount. */
	unregister: (channelId: string) => void;
	/** The current search scope. */
	scope: Ref<SearchScope>;
	/** Set the search scope. */
	setScope: (scope: SearchScope) => void;
	/** The channelId of the pane where the current match is (cross-pane indicator). */
	matchPaneChannelId: Ref<string | null>;
	/** Trigger "find next" across all panes (when scope = "all"). */
	findNextAll: (currentChannelId: string, layoutNode: PaneNode | null) => void;
	/** Trigger "find previous" across all panes (when scope = "all"). */
	findPreviousAll: (currentChannelId: string, layoutNode: PaneNode | null) => void;
	/** Broadcast search query to all panes (when scope = "all"). */
	searchAll: (query: string, layoutNode: PaneNode | null) => void;
	/** Clear search on all panes. */
	clearAll: () => void;
	/** Aggregated match count across all panes. */
	totalMatchCount: Ref<number>;
	/** Aggregated current match index across all panes. */
	totalCurrentMatch: Ref<number>;
	/** Callback to focus a specific pane by channelId (SC-11). */
	onFocusPane: Ref<((channelId: string) => void) | null>;
}

export const MULTI_PANE_SEARCH_KEY: InjectionKey<MultiPaneSearchRegistry> =
	Symbol("multi-pane-search");

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Create the multi-pane search registry. Call once at the App/layout level
 * and `provide(MULTI_PANE_SEARCH_KEY, registry)`.
 */
export function useMultiPaneSearch(): MultiPaneSearchRegistry {
	/** Shallow ref to avoid Vue deep-unwrapping Ref fields inside PaneSearchHandle. */
	const handles = shallowRef<Record<string, PaneSearchHandle>>({});
	const scope = ref<SearchScope>("pane");
	const matchPaneChannelId = ref<string | null>(null);

	/** The last layout node used — cached for rotation. */
	let lastOrderedIds: string[] = [];

	const onFocusPane = ref<((channelId: string) => void) | null>(null);

	function register(handle: PaneSearchHandle): void {
		handles.value = { ...handles.value, [handle.channelId]: handle };
	}

	function unregister(channelId: string): void {
		const { [channelId]: _, ...rest } = handles.value;
		handles.value = rest;
	}

	function setScope(s: SearchScope): void {
		scope.value = s;
		if (s === "pane") {
			// When switching back to single-pane, clear all other panes
			clearAll();
			matchPaneChannelId.value = null;
		}
	}

	/** Get ordered channel IDs from layout, caching for reuse. */
	function getOrderedIds(layoutNode: PaneNode | null): string[] {
		if (layoutNode === null) return [];
		lastOrderedIds = collectTerminalChannelIds(layoutNode);
		return lastOrderedIds;
	}

	function searchAll(query: string, layoutNode: PaneNode | null): void {
		const orderedIds = getOrderedIds(layoutNode);
		for (const id of orderedIds) {
			const handle = handles.value[id];
			if (handle) {
				handle.search(query);
			}
		}
		// Reset rotation to the first pane with matches
		matchPaneChannelId.value = null;
	}

	function clearAll(): void {
		for (const handle of Object.values(handles.value)) {
			handle.clear();
		}
		matchPaneChannelId.value = null;
	}

	function navigateMatches(
		direction: "next" | "previous",
		currentChannelId: string,
		layoutNode: PaneNode | null,
	): void {
		const orderedIds = getOrderedIds(layoutNode);
		if (orderedIds.length === 0) return;

		let startIdx = orderedIds.indexOf(currentChannelId);
		if (startIdx === -1) startIdx = 0;

		const startId = orderedIds[startIdx];
		if (startId === undefined) return;

		const isNext = direction === "next";
		const move = (h: PaneSearchHandle) => (isNext ? h.findNext() : h.findPrevious());
		const atBoundary = (h: PaneSearchHandle) =>
			isNext ? h.currentMatch.value >= h.matchCount.value : h.currentMatch.value <= 1;
		const nextIdx = (offset: number) =>
			isNext
				? (startIdx + offset) % orderedIds.length
				: (startIdx - offset + orderedIds.length) % orderedIds.length;

		const currentHandle = handles.value[startId];
		if (currentHandle && currentHandle.matchCount.value > 0) {
			if (!atBoundary(currentHandle)) {
				move(currentHandle);
				matchPaneChannelId.value = startId;
				return;
			}
		}

		for (let offset = 1; offset <= orderedIds.length; offset++) {
			const idx = nextIdx(offset);
			const peerId = orderedIds[idx];
			if (peerId === undefined) continue;
			const handle = handles.value[peerId];
			if (handle && handle.matchCount.value > 0) {
				move(handle);
				matchPaneChannelId.value = peerId;
				if (idx !== startIdx && onFocusPane.value) {
					onFocusPane.value(peerId);
				}
				return;
			}
		}

		// Wrap within single pane
		if (currentHandle && currentHandle.matchCount.value > 0) {
			move(currentHandle);
			matchPaneChannelId.value = startId;
		}
	}

	function findNextAll(currentChannelId: string, layoutNode: PaneNode | null): void {
		navigateMatches("next", currentChannelId, layoutNode);
	}

	function findPreviousAll(currentChannelId: string, layoutNode: PaneNode | null): void {
		navigateMatches("previous", currentChannelId, layoutNode);
	}

	const totalMatchCount = computed(() => {
		let total = 0;
		for (const handle of Object.values(handles.value)) {
			total += handle.matchCount.value;
		}
		return total;
	});

	const totalCurrentMatch = computed(() => {
		// Sum currentMatch across all panes up to and including the active one
		if (matchPaneChannelId.value === null) return 0;
		const handle = handles.value[matchPaneChannelId.value];
		if (!handle) return 0;

		// Count matches in all panes before the active one
		let preceding = 0;
		for (const id of lastOrderedIds) {
			if (id === matchPaneChannelId.value) break;
			const h = handles.value[id];
			if (h) preceding += h.matchCount.value;
		}
		return preceding + handle.currentMatch.value;
	});

	return {
		register,
		unregister,
		scope,
		setScope,
		matchPaneChannelId,
		findNextAll,
		findPreviousAll,
		searchAll,
		clearAll,
		totalMatchCount,
		totalCurrentMatch,
		onFocusPane,
	};
}
