import { DEFAULT_CHANNEL_NAME, generateId } from "@nexterm/shared";
import { computed, ref, watch } from "vue";
import { useChannelsStore } from "../stores/channels.js";

// ---------------------------------------------------------------------------
// Pane tree types
// ---------------------------------------------------------------------------

export type PaneNode =
	| { type: "terminal"; channelId: string; paneId: string }
	| {
			type: "split";
			direction: "horizontal" | "vertical";
			ratio: number;
			first: PaneNode;
			second: PaneNode;
	  };

export interface Tab {
	channelId: string;
	label: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence key
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "nexterm:layout";

interface PersistedState {
	tabs: Tab[];
	activeTabIndex: number;
	layouts: Record<string, PaneNode | null>;
}

/** Ensure all terminal nodes have a paneId (backward compat with old persisted state). */
function ensurePaneIds(node: PaneNode): PaneNode {
	if (node.type === "terminal") {
		return node.paneId ? node : { ...node, paneId: generateId() };
	}
	return { ...node, first: ensurePaneIds(node.first), second: ensurePaneIds(node.second) };
}

function loadFromStorage(): PersistedState | null {
	try {
		const raw = localStorage.getItem(LAYOUT_KEY);
		if (raw === null) return null;
		const state = JSON.parse(raw) as PersistedState;
		// Migrate old layouts that lack paneId
		for (const key of Object.keys(state.layouts)) {
			const tree = state.layouts[key];
			if (tree !== null && tree !== undefined) state.layouts[key] = ensurePaneIds(tree);
		}
		return state;
	} catch {
		return null;
	}
}

function saveToStorage(state: PersistedState): void {
	try {
		localStorage.setItem(LAYOUT_KEY, JSON.stringify(state));
	} catch {
		// Ignore storage errors (e.g. private browsing quota)
	}
}

// ---------------------------------------------------------------------------
// Path type for addressing nodes in the pane tree
// ---------------------------------------------------------------------------

/**
 * A path from the root to a node, expressed as a sequence of "first" | "second"
 * turns at each split node. Empty array = root.
 */
export type NodePath = Array<"first" | "second">;

// ---------------------------------------------------------------------------
// Helper: immutably set a node at a given path in the tree
// ---------------------------------------------------------------------------

function setNodeAtPath(root: PaneNode, path: NodePath, node: PaneNode): PaneNode {
	if (path.length === 0) return node;

	if (root.type !== "split") {
		// Path leads into a terminal — shouldn't happen
		return root;
	}

	const [head, ...rest] = path;
	if (head === "first") {
		return { ...root, first: setNodeAtPath(root.first, rest, node) };
	}
	return { ...root, second: setNodeAtPath(root.second, rest, node) };
}

// ---------------------------------------------------------------------------
// Helper: find the path to the node containing the given channelId
// ---------------------------------------------------------------------------

function findChannelPath(root: PaneNode, channelId: string): NodePath | null {
	if (root.type === "terminal") {
		return root.channelId === channelId ? [] : null;
	}
	const inFirst = findChannelPath(root.first, channelId);
	if (inFirst !== null) return ["first", ...inFirst];
	const inSecond = findChannelPath(root.second, channelId);
	if (inSecond !== null) return ["second", ...inSecond];
	return null;
}

// ---------------------------------------------------------------------------
// Helper: get node at path
// ---------------------------------------------------------------------------

function getNodeAtPath(root: PaneNode, path: NodePath): PaneNode | null {
	if (path.length === 0) return root;
	if (root.type !== "split") return null;
	const [head, ...rest] = path;
	return getNodeAtPath(head === "first" ? root.first : root.second, rest);
}

// ---------------------------------------------------------------------------
// Helper: replace channelId in a tree (preserving paneId)
// ---------------------------------------------------------------------------

function replaceInTree(node: PaneNode, oldId: string, newId: string): PaneNode {
	if (node.type === "terminal") {
		return node.channelId === oldId ? { ...node, channelId: newId } : node;
	}
	return {
		...node,
		first: replaceInTree(node.first, oldId, newId),
		second: replaceInTree(node.second, oldId, newId),
	};
}

// ---------------------------------------------------------------------------
// Pure helper: resolve tab label
// ---------------------------------------------------------------------------

/**
 * Resolve the display label for a channel in a tab or pane.
 * Prefers the server-side channel title, falls back to the tab label,
 * then DEFAULT_CHANNEL_NAME.
 *
 * Extracted as a standalone function for testability — no Vue/Pinia deps.
 */
export function resolveTabLabel(
	channelId: string,
	channels: ReadonlyArray<{ id: string; title?: string }>,
	tabs: ReadonlyArray<{ channelId: string; label: string }>,
): string {
	const channel = channels.find((c) => c.id === channelId);
	if (channel?.title) return channel.title;
	const tab = tabs.find((t) => t.channelId === channelId);
	return tab?.label ?? DEFAULT_CHANNEL_NAME;
}

// ---------------------------------------------------------------------------
// Pure helper: purge dead tabs
// ---------------------------------------------------------------------------

/**
 * Close tabs whose channels have a "dead" status.
 * Iterates in reverse so that index-based closeTab remains valid as items
 * are removed.
 *
 * Extracted as a standalone function for testability — no Vue/Pinia deps.
 */
export function purgeDeadTabs(
	channels: ReadonlyArray<{ id: string; status: string }>,
	tabs: ReadonlyArray<{ channelId: string }>,
	closeTab: (index: number) => void,
): void {
	const deadIds = new Set(channels.filter((c) => c.status === "dead").map((c) => c.id));
	for (let i = tabs.length - 1; i >= 0; i--) {
		const tab = tabs[i];
		if (tab !== undefined && deadIds.has(tab.channelId)) {
			closeTab(i);
		}
	}
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Manages the tab bar and recursive pane-split layout for the main terminal area.
 *
 * One layout tree is maintained per tab (keyed by channelId of the tab's root channel).
 * State is persisted to localStorage so layout survives page refresh.
 */
export function useLayout() {
	const persisted = loadFromStorage();

	const tabs = ref<Tab[]>(persisted?.tabs ?? []);
	const activeTabIndex = ref<number>(persisted?.activeTabIndex ?? 0);

	/**
	 * Per-tab layout trees. Key = tab.channelId (the channel that opened the tab,
	 * which is always the root of the pane tree for that tab).
	 */
	const layouts = ref<Record<string, PaneNode | null>>(persisted?.layouts ?? {});

	// ------------------------------------------------------------------
	// Derived: layout for the currently active tab
	// ------------------------------------------------------------------

	const activeTab = computed<Tab | null>(() => tabs.value[activeTabIndex.value] ?? null);

	const layout = computed<PaneNode | null>(() => {
		const tab = activeTab.value;
		if (tab === null) return null;
		return layouts.value[tab.channelId] ?? null;
	});

	// ------------------------------------------------------------------
	// Persistence
	// ------------------------------------------------------------------

	function persist(): void {
		saveToStorage({
			tabs: tabs.value,
			activeTabIndex: activeTabIndex.value,
			layouts: layouts.value,
		});
	}

	// Persist automatically when reactive state changes
	watch([tabs, activeTabIndex, layouts], persist, { deep: true });

	// ------------------------------------------------------------------
	// Tab management
	// ------------------------------------------------------------------

	/**
	 * Open a tab for `channelId`. If a tab for this channel already exists,
	 * switch to it. Otherwise append a new tab and activate it.
	 */
	function openTab(channelId: string, label: string): void {
		const existingIdx = tabs.value.findIndex((t) => t.channelId === channelId);
		if (existingIdx !== -1) {
			activeTabIndex.value = existingIdx;
			return;
		}

		tabs.value = [...tabs.value, { channelId, label }];
		activeTabIndex.value = tabs.value.length - 1;

		// Initialize layout for the new tab as a single terminal pane
		if (!(channelId in layouts.value)) {
			layouts.value = {
				...layouts.value,
				[channelId]: { type: "terminal", channelId, paneId: generateId() },
			};
		}
	}

	/**
	 * Close the tab at `index`. Adjusts activeTabIndex to remain valid.
	 */
	function closeTab(index: number): void {
		const tab = tabs.value[index];
		if (tab === undefined) return;

		const next = tabs.value.filter((_, i) => i !== index);
		tabs.value = next;

		// Remove the persisted layout for the closed tab's root channel
		const { [tab.channelId]: _removed, ...restLayouts } = layouts.value;
		layouts.value = restLayouts;

		// Clamp active index
		if (activeTabIndex.value >= next.length) {
			activeTabIndex.value = Math.max(0, next.length - 1);
		} else if (activeTabIndex.value > index) {
			activeTabIndex.value = activeTabIndex.value - 1;
		}
	}

	/**
	 * Switch to the tab at `index`.
	 */
	function setActiveTab(index: number): void {
		if (index >= 0 && index < tabs.value.length) {
			activeTabIndex.value = index;
		}
	}

	// ------------------------------------------------------------------
	// Layout manipulation
	// ------------------------------------------------------------------

	/**
	 * Update the pane layout for the active tab.
	 */
	function setLayout(node: PaneNode | null): void {
		const tab = activeTab.value;
		if (tab === null) return;
		layouts.value = { ...layouts.value, [tab.channelId]: node };
	}

	/**
	 * Split the pane that currently contains `channelId` into two panes.
	 * The original pane keeps `channelId`; the second pane is a new empty
	 * terminal pane identified by `newChannelId`.
	 *
	 * If the layout is null (no tabs), this is a no-op.
	 */
	function splitPane(
		channelId: string,
		direction: "horizontal" | "vertical",
		newChannelId: string,
		newLabel: string,
	): void {
		const tab = activeTab.value;
		if (tab === null) return;

		const root = layouts.value[tab.channelId];
		if (root === null || root === undefined) return;

		const path = findChannelPath(root, channelId);
		if (path === null) return;

		const existingNode = getNodeAtPath(root, path);
		if (existingNode === null) return;

		const splitNode: PaneNode = {
			type: "split",
			direction,
			ratio: 0.5,
			first: existingNode,
			second: { type: "terminal", channelId: newChannelId, paneId: generateId() },
		};

		const newRoot = setNodeAtPath(root, path, splitNode);
		layouts.value = { ...layouts.value, [tab.channelId]: newRoot };

		// Register new channel label in our internal label map but do NOT
		// create a top-level tab for it — it lives inside the split.
		_paneLabels.value = { ..._paneLabels.value, [newChannelId]: newLabel };
	}

	/**
	 * Remove a split by replacing the parent split node with the sibling of
	 * the pane that contained `channelId`.
	 */
	function unsplitPane(channelId: string): void {
		const tab = activeTab.value;
		if (tab === null) return;

		const root = layouts.value[tab.channelId];
		if (root === null || root === undefined) return;

		const path = findChannelPath(root, channelId);
		if (path === null || path.length === 0) return;

		// Parent path = all but last segment; sibling = the other branch
		const parentPath = path.slice(0, -1);
		const lastTurn = path[path.length - 1];
		if (lastTurn === undefined) return;
		const siblingTurn = lastTurn === "first" ? "second" : "first";

		const parentNode = getNodeAtPath(root, parentPath);
		if (parentNode === null || parentNode.type !== "split") return;

		const sibling = siblingTurn === "first" ? parentNode.first : parentNode.second;

		let newRoot: PaneNode;
		if (parentPath.length === 0) {
			// Parent is the root — replace root with sibling
			newRoot = sibling;
		} else {
			newRoot = setNodeAtPath(root, parentPath, sibling);
		}

		layouts.value = { ...layouts.value, [tab.channelId]: newRoot };
	}

	/**
	 * Update the split ratio for a split node identified by the path from
	 * the root. The path is provided by the PaneSplitter component.
	 */
	function updateRatio(splitNodePath: NodePath, ratio: number): void {
		const tab = activeTab.value;
		if (tab === null) return;

		const root = layouts.value[tab.channelId];
		if (root === null || root === undefined) return;

		const splitNode = getNodeAtPath(root, splitNodePath);
		if (splitNode === null || splitNode.type !== "split") return;

		const clamped = Math.min(0.9, Math.max(0.1, ratio));
		const updated: PaneNode = { ...splitNode, ratio: clamped };
		const newRoot = setNodeAtPath(root, splitNodePath, updated);
		layouts.value = { ...layouts.value, [tab.channelId]: newRoot };
	}

	// ------------------------------------------------------------------
	// Channel ID replacement (pending spawn → real channel)
	// ------------------------------------------------------------------

	/**
	 * Replace a temporary channelId with the real one after a deferred spawn.
	 * Updates tabs, layout tree keys, and pane labels. The paneId stays stable
	 * so Vue reuses the TerminalPane component (no destroy/recreate).
	 */
	function replaceChannelId(oldId: string, newId: string): void {
		// 1. Update tabs (label is NOT overwritten — getTabLabel() resolves from server title)
		tabs.value = tabs.value.map((t) => (t.channelId === oldId ? { ...t, channelId: newId } : t));

		// 2. Update all layout trees (key + inner nodes)
		const newLayouts: Record<string, PaneNode | null> = {};
		for (const [key, tree] of Object.entries(layouts.value)) {
			const newKey = key === oldId ? newId : key;
			newLayouts[newKey] = tree !== null ? replaceInTree(tree, oldId, newId) : null;
		}
		layouts.value = newLayouts;

		// 3. Update pane labels (carry over without overwriting)
		const oldLabel = _paneLabels.value[oldId];
		if (oldLabel !== undefined) {
			const { [oldId]: _, ...rest } = _paneLabels.value;
			_paneLabels.value = { ...rest, [newId]: oldLabel };
		}
	}

	// ------------------------------------------------------------------
	// Internal label map for split panes (not top-level tabs)
	// ------------------------------------------------------------------

	/** Labels for channels that appear in split panes but not as top-level tabs. */
	const _paneLabels = ref<Record<string, string>>({});

	function getPaneLabel(channelId: string): string {
		// Check top-level tabs first
		const tab = tabs.value.find((t) => t.channelId === channelId);
		if (tab !== undefined) return tab.label;
		// Fall back to split-pane labels
		return _paneLabels.value[channelId] ?? DEFAULT_CHANNEL_NAME;
	}

	/**
	 * Resolve the display label for a tab/pane. Delegates to the pure
	 * `resolveTabLabel` helper, passing in the channels store data.
	 */
	function getTabLabel(channelId: string): string {
		const channelsStore = useChannelsStore();
		return resolveTabLabel(channelId, channelsStore.channels, tabs.value);
	}

	return {
		tabs,
		activeTabIndex,
		activeTab,
		layout,
		layouts,
		openTab,
		closeTab,
		setActiveTab,
		setLayout,
		splitPane,
		unsplitPane,
		updateRatio,
		replaceChannelId,
		getPaneLabel,
		getTabLabel,
	};
}
