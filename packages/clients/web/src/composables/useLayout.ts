import { DEFAULT_CHANNEL_NAME, generateId } from "@nexterm/shared";
import { computed, ref, watch } from "vue";
import { useChannelsStore } from "../stores/channels.js";
import { useConfigStore } from "../stores/config.js";

// ---------------------------------------------------------------------------
// Pane tree types
// ---------------------------------------------------------------------------

export type PaneNode =
	| { type: "terminal"; channelId: string; paneId: string }
	| { type: "vacant"; id: string }
	| {
			type: "split";
			direction: "horizontal" | "vertical";
			ratio: number;
			first: PaneNode;
			second: PaneNode;
	  };

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export interface Tab {
	channelId: string;
	label: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence key
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "nexterm:layout";

/** Hard invariant INV-10: maximum panes per tab. Not user-configurable. */
const MAX_PANE_COUNT = 4;

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
	if (node.type === "vacant") return node;
	return { ...node, first: ensurePaneIds(node.first), second: ensurePaneIds(node.second) };
}

function countLeaves(node: PaneNode): number {
	if (node.type !== "split") return 1;
	return countLeaves(node.first) + countLeaves(node.second);
}

function truncateToMaxPanes(node: PaneNode, max: number): PaneNode {
	if (countLeaves(node) <= max) return node;
	// Too many panes — reset to the first leaf
	if (node.type === "split") return truncateToMaxPanes(node.first, max);
	return node;
}

function loadFromStorage(): PersistedState | null {
	try {
		const raw = localStorage.getItem(LAYOUT_KEY);
		if (raw === null) return null;
		const state = JSON.parse(raw) as PersistedState;
		// Migrate old layouts that lack paneId; enforce max pane count (INV-10)
		for (const key of Object.keys(state.layouts)) {
			let tree = state.layouts[key];
			if (tree !== null && tree !== undefined) {
				tree = ensurePaneIds(tree);
				tree = truncateToMaxPanes(tree, MAX_PANE_COUNT);
				state.layouts[key] = tree;
			}
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
	if (root.type === "vacant") return null;
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
	if (root.type !== "split") return null; // terminal or vacant — path goes nowhere
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
	if (node.type === "vacant") return node;
	return {
		...node,
		first: replaceInTree(node.first, oldId, newId),
		second: replaceInTree(node.second, oldId, newId),
	};
}

// ---------------------------------------------------------------------------
// Helper: find the path to a vacant node by its id
// ---------------------------------------------------------------------------

function findVacantPath(root: PaneNode, vacantId: string): NodePath | null {
	if (root.type === "vacant") {
		return root.id === vacantId ? [] : null;
	}
	if (root.type === "terminal") return null;
	const inFirst = findVacantPath(root.first, vacantId);
	if (inFirst !== null) return ["first", ...inFirst];
	const inSecond = findVacantPath(root.second, vacantId);
	if (inSecond !== null) return ["second", ...inSecond];
	return null;
}

// ---------------------------------------------------------------------------
// Helper: replace a terminal node matching channelId with a replacement node
// ---------------------------------------------------------------------------

function replaceTerminalNode(
	node: PaneNode,
	channelId: string,
	replacement: PaneNode,
): PaneNode | null {
	if (node.type === "terminal") {
		return node.channelId === channelId ? replacement : null;
	}
	if (node.type === "vacant") return null;
	const firstResult = replaceTerminalNode(node.first, channelId, replacement);
	if (firstResult !== null) {
		return { ...node, first: firstResult };
	}
	const secondResult = replaceTerminalNode(node.second, channelId, replacement);
	if (secondResult !== null) {
		return { ...node, second: secondResult };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Helper: get the unique leaf ID for a pane node (paneId or vacant id)
// ---------------------------------------------------------------------------

function getLeafId(node: PaneNode): string | null {
	if (node.type === "terminal") return node.paneId;
	if (node.type === "vacant") return node.id;
	return null;
}

// ---------------------------------------------------------------------------
// Helper: find a leaf node path by its paneId or vacant id
// ---------------------------------------------------------------------------

function findNodePathByPaneId(root: PaneNode, paneId: string): NodePath | null {
	const leafId = getLeafId(root);
	if (leafId === paneId) return [];
	if (root.type !== "split") return null;
	const inFirst = findNodePathByPaneId(root.first, paneId);
	if (inFirst !== null) return ["first", ...inFirst];
	const inSecond = findNodePathByPaneId(root.second, paneId);
	if (inSecond !== null) return ["second", ...inSecond];
	return null;
}

// ---------------------------------------------------------------------------
// Helper: replace a leaf node matching paneId/vacantId with a replacement
// ---------------------------------------------------------------------------

function replaceNodeByPaneId(
	node: PaneNode,
	paneId: string,
	replacement: PaneNode,
): PaneNode | null {
	const leafId = getLeafId(node);
	if (leafId === paneId) return replacement;
	if (node.type !== "split") return null;
	const firstResult = replaceNodeByPaneId(node.first, paneId, replacement);
	if (firstResult !== null) {
		return { ...node, first: firstResult };
	}
	const secondResult = replaceNodeByPaneId(node.second, paneId, replacement);
	if (secondResult !== null) {
		return { ...node, second: secondResult };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Exported helper: count leaf panes (terminal + vacant)
// ---------------------------------------------------------------------------

export function countPanes(node: PaneNode): number {
	if (node.type === "terminal" || node.type === "vacant") return 1;
	return countPanes(node.first) + countPanes(node.second);
}

// ---------------------------------------------------------------------------
// Exported helper: collect terminal channelIds in depth-first order
// ---------------------------------------------------------------------------

/**
 * Walk the pane tree depth-first and return all terminal channelIds.
 * Skips vacant nodes (INV-06). Used by multi-pane search to iterate
 * over all searchable panes in a tab.
 */
export function collectTerminalChannelIds(node: PaneNode): string[] {
	if (node.type === "terminal") return [node.channelId];
	if (node.type === "vacant") return [];
	return [...collectTerminalChannelIds(node.first), ...collectTerminalChannelIds(node.second)];
}

// ---------------------------------------------------------------------------
// Pure helper: resolve tab label
// ---------------------------------------------------------------------------

/**
 * Resolve the display label for a channel in a tab or pane.
 *
 * Title priority (INV-01):
 *   1. Custom title (from F2 rename) — channel.title
 *   2. Dynamic title (from OSC 0/2) — channel.dynamicTitle
 *   3. Tab label or DEFAULT_CHANNEL_NAME fallback
 *
 * Extracted as a standalone function for testability — no Vue/Pinia deps.
 */
export function resolveTabLabel(
	channelId: string,
	channels: ReadonlyArray<{ id: string; title?: string; dynamicTitle?: string }>,
	tabs: ReadonlyArray<{ channelId: string; label: string }>,
): string {
	const channel = channels.find((c) => c.id === channelId);
	if (channel?.title) return channel.title;
	if (channel?.dynamicTitle) return channel.dynamicTitle;
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

/**
 * Close tabs whose channels no longer exist on the given host.
 * After a hub/agent restart, channels may be gone from the API but tabs
 * persist in localStorage. This purges those orphaned references.
 *
 * Only purges tabs known to belong to `hostId` (via channelHostMap) to
 * avoid closing tabs for channels on other hosts that haven't been fetched.
 */
export function purgeOrphanedTabs(
	channels: ReadonlyArray<{ id: string }>,
	tabs: ReadonlyArray<{ channelId: string }>,
	closeTab: (index: number) => void,
	hostId: string,
	channelHostMap: ReadonlyMap<string, string>,
): void {
	const aliveIds = new Set(channels.map((c) => c.id));
	for (let i = tabs.length - 1; i >= 0; i--) {
		const tab = tabs[i];
		if (tab === undefined) continue;
		const tabHost = channelHostMap.get(tab.channelId);
		if (tabHost === hostId && !aliveIds.has(tab.channelId)) {
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

		const configStore = useConfigStore();
		const newTabPosition = configStore.uiConfig.tabs?.newTabPosition;
		if (newTabPosition === "afterActive") {
			const insertIdx = activeTabIndex.value + 1;
			const newTabs = [...tabs.value];
			newTabs.splice(insertIdx, 0, { channelId, label });
			tabs.value = newTabs;
			activeTabIndex.value = insertIdx;
		} else {
			tabs.value = [...tabs.value, { channelId, label }];
			activeTabIndex.value = tabs.value.length - 1;
		}

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

	/**
	 * Reorder a tab from one position to another (drag-and-drop).
	 * Adjusts activeTabIndex so the currently active tab stays active.
	 */
	function reorderTab(fromIndex: number, toIndex: number): void {
		if (fromIndex === toIndex) return;
		if (fromIndex < 0 || fromIndex >= tabs.value.length) return;
		// Clamp toIndex to valid range
		const clampedTo = Math.max(0, Math.min(toIndex, tabs.value.length - 1));
		if (fromIndex === clampedTo) return;

		const newTabs = [...tabs.value];
		const [moved] = newTabs.splice(fromIndex, 1);
		if (moved === undefined) return;
		newTabs.splice(clampedTo, 0, moved);
		tabs.value = newTabs;

		// Adjust active tab index to follow the active tab
		const currentActive = activeTabIndex.value;
		if (currentActive === fromIndex) {
			// The active tab was dragged
			activeTabIndex.value = clampedTo;
		} else if (fromIndex < currentActive && clampedTo >= currentActive) {
			// Moved from before active to after → active shifts left
			activeTabIndex.value = currentActive - 1;
		} else if (fromIndex > currentActive && clampedTo <= currentActive) {
			// Moved from after active to before → active shifts right
			activeTabIndex.value = currentActive + 1;
		}
		// Otherwise active tab index is unaffected
	}

	// ------------------------------------------------------------------
	// Bulk close operations
	// ------------------------------------------------------------------

	/** Replace all terminal nodes in a tab's layout with vacant slots. */
	function vacateAllPanesInTab(tabChannelId: string): void {
		const root = layouts.value[tabChannelId];
		if (root === null || root === undefined) return;

		function vacateNode(node: PaneNode): PaneNode {
			if (node.type === "terminal") return { type: "vacant", id: generateId() };
			if (node.type === "vacant") return node;
			return {
				type: "split",
				direction: node.direction,
				ratio: node.ratio,
				first: vacateNode(node.first),
				second: vacateNode(node.second),
			};
		}

		layouts.value = { ...layouts.value, [tabChannelId]: vacateNode(root) };
	}

	/** Close all tabs except the one at `keepIndex`. */
	function closeOthers(keepIndex: number): void {
		const kept = tabs.value[keepIndex];
		if (!kept) return;
		// Clean up layouts for removed tabs
		const keptLayout = layouts.value[kept.channelId];
		layouts.value = keptLayout != null ? { [kept.channelId]: keptLayout } : {};
		tabs.value = [kept];
		activeTabIndex.value = 0;
	}

	/** Close all tabs to the right of `fromIndex`. */
	function closeToRight(fromIndex: number): void {
		const removed = tabs.value.slice(fromIndex + 1);
		const nextLayouts = { ...layouts.value };
		for (const tab of removed) {
			delete nextLayouts[tab.channelId];
		}
		tabs.value = tabs.value.slice(0, fromIndex + 1);
		layouts.value = nextLayouts;
		// Clamp active index if needed
		if (activeTabIndex.value >= tabs.value.length) {
			activeTabIndex.value = Math.max(0, tabs.value.length - 1);
		}
	}

	/** Close all tabs. If `exceptWelcomeId` is provided, keep that tab. */
	function closeAll(exceptWelcomeId?: string): void {
		if (exceptWelcomeId) {
			const keepIdx = tabs.value.findIndex((t) => t.channelId === exceptWelcomeId);
			// Remove all tabs except the welcome one
			const keepTab = keepIdx >= 0 ? tabs.value[keepIdx] : undefined;
			const kept = keepTab !== undefined ? [keepTab] : [];
			// Clean up layouts for removed tabs
			const removedLayouts = { ...layouts.value };
			for (const tab of tabs.value) {
				if (tab.channelId !== exceptWelcomeId) {
					delete removedLayouts[tab.channelId];
				}
			}
			tabs.value = kept;
			layouts.value = removedLayouts;
			activeTabIndex.value = 0;
		} else {
			tabs.value = [];
			layouts.value = {};
			activeTabIndex.value = 0;
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

	// ------------------------------------------------------------------
	// Vacant pane management
	// ------------------------------------------------------------------

	/**
	 * Replace a terminal pane with a vacant slot (detach, don't remove).
	 * INV-03: closing a pane detaches the terminal — it keeps running.
	 */
	function vacatePane(channelId: string): void {
		const tab = activeTab.value;
		if (tab === null) return;

		const root = layouts.value[tab.channelId];
		if (root === null || root === undefined) return;

		const updated = replaceTerminalNode(root, channelId, { type: "vacant", id: generateId() });
		if (updated !== null) {
			layouts.value = { ...layouts.value, [tab.channelId]: updated };
		}
	}

	/**
	 * Fill a vacant slot with a channel.
	 */
	function fillVacant(vacantId: string, channelId: string): void {
		const tab = activeTab.value;
		if (tab === null) return;

		const root = layouts.value[tab.channelId];
		if (root === null || root === undefined) return;

		const path = findVacantPath(root, vacantId);
		if (path === null) return;

		const replacement: PaneNode = { type: "terminal", channelId, paneId: generateId() };
		const newRoot = setNodeAtPath(root, path, replacement);
		layouts.value = { ...layouts.value, [tab.channelId]: newRoot };
	}

	/**
	 * Remove a vacant pane by collapsing the parent split. The sibling expands
	 * to fill the space. If the root is vacant, do nothing (can't rearrange
	 * the last pane — INV-04: tab never auto-closes).
	 */
	function rearrangeVacant(vacantId: string): void {
		const tab = activeTab.value;
		if (tab === null) return;

		const root = layouts.value[tab.channelId];
		if (root === null || root === undefined) return;

		const path = findVacantPath(root, vacantId);
		if (path === null || path.length === 0) return; // root vacant — can't rearrange

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
			newRoot = sibling;
		} else {
			newRoot = setNodeAtPath(root, parentPath, sibling);
		}

		layouts.value = { ...layouts.value, [tab.channelId]: newRoot };
	}

	// ------------------------------------------------------------------
	// Cross-tab pane DnD
	// ------------------------------------------------------------------

	/**
	 * Vacate a pane in a SPECIFIC tab (not just the active one).
	 * Needed for cross-tab drag where source tab is not active.
	 */
	function vacatePaneInTab(tabChannelId: string, channelId: string): void {
		const root = layouts.value[tabChannelId];
		if (root === null || root === undefined) return;

		const updated = replaceTerminalNode(root, channelId, {
			type: "vacant",
			id: generateId(),
		});
		if (updated !== null) {
			layouts.value = { ...layouts.value, [tabChannelId]: updated };
		}
	}

	/**
	 * Find which tab contains a given channel ID.
	 * Returns the tab's root channelId, or null if not found.
	 */
	function findTabForChannel(channelId: string): string | null {
		for (const [tabKey, root] of Object.entries(layouts.value)) {
			if (root !== null && findChannelPath(root, channelId) !== null) {
				return tabKey;
			}
		}
		return null;
	}

	/**
	 * Move a pane from one location to another (possibly cross-tab).
	 *
	 * - CENTER: replace the target pane content with the source
	 * - LEFT/RIGHT: wrap target in horizontal split, source on chosen side
	 * - TOP/BOTTOM: wrap target in vertical split, source on chosen side
	 *
	 * The source pane is vacated (replaced with a vacant slot).
	 * If the source pane is the only pane in its tab, that tab is NOT closed
	 * (INV-04: tabs never auto-close) — a vacant slot remains.
	 */
	function movePaneTo(
		sourceChannelId: string,
		targetPaneId: string,
		targetTabChannelId: string,
		zone: DropZone,
	): void {
		// 1. Find source tab
		const sourceTabKey = findTabForChannel(sourceChannelId);
		if (sourceTabKey === null) return;

		// 2. Vacate source FIRST to avoid duplicate channelId in same-tab moves.
		//    After this, the source slot becomes vacant. Then we re-read the
		//    (possibly mutated) target root for the insertion step.
		vacatePaneInTab(sourceTabKey, sourceChannelId);

		const targetRoot = layouts.value[targetTabChannelId];
		if (targetRoot === null || targetRoot === undefined) return;

		// 3. Build source terminal node (reuse channel, fresh paneId)
		const sourceNode: PaneNode = {
			type: "terminal",
			channelId: sourceChannelId,
			paneId: generateId(),
		};

		if (zone === "center") {
			// Replace target pane content with source
			const updated = replaceNodeByPaneId(targetRoot, targetPaneId, sourceNode);
			if (updated === null) return;
			layouts.value = { ...layouts.value, [targetTabChannelId]: updated };
		} else {
			// Find the target node in the tree
			const targetPath = findNodePathByPaneId(targetRoot, targetPaneId);
			if (targetPath === null) return;

			const existingNode = getNodeAtPath(targetRoot, targetPath);
			if (existingNode === null) return;

			const direction: "horizontal" | "vertical" =
				zone === "left" || zone === "right" ? "vertical" : "horizontal";
			const first = zone === "left" || zone === "top" ? sourceNode : existingNode;
			const second = zone === "left" || zone === "top" ? existingNode : sourceNode;

			const splitNode: PaneNode = {
				type: "split",
				direction,
				ratio: 0.5,
				first,
				second,
			};

			const updated = setNodeAtPath(targetRoot, targetPath, splitNode);
			layouts.value = { ...layouts.value, [targetTabChannelId]: updated };
		}
	}

	/**
	 * Move a pane out of its current tab into a brand-new tab.
	 * The new tab is inserted at `insertAtIndex`.
	 */
	function moveToNewTab(sourceChannelId: string, insertAtIndex: number): void {
		const sourceTabKey = findTabForChannel(sourceChannelId);
		if (sourceTabKey === null) return;

		// Vacate the source pane first
		vacatePaneInTab(sourceTabKey, sourceChannelId);

		// Create the new tab with the channel
		const label = getPaneLabel(sourceChannelId);
		const newTab: Tab = { channelId: sourceChannelId, label };
		const newLayout: PaneNode = {
			type: "terminal",
			channelId: sourceChannelId,
			paneId: generateId(),
		};

		// Insert tab at position
		const idx = Math.max(0, Math.min(insertAtIndex, tabs.value.length));
		const newTabs = [...tabs.value];
		newTabs.splice(idx, 0, newTab);
		tabs.value = newTabs;

		layouts.value = { ...layouts.value, [sourceChannelId]: newLayout };
		activeTabIndex.value = idx;
	}

	return {
		tabs,
		activeTabIndex,
		activeTab,
		layout,
		layouts,
		openTab,
		closeTab,
		closeOthers,
		closeToRight,
		closeAll,
		vacateAllPanesInTab,
		setActiveTab,
		reorderTab,
		setLayout,
		splitPane,
		unsplitPane,
		updateRatio,
		replaceChannelId,
		getPaneLabel,
		getTabLabel,
		vacatePane,
		fillVacant,
		rearrangeVacant,
		movePaneTo,
		moveToNewTab,
		findTabForChannel,
	};
}
