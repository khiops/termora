import { computed, ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useChannelsStore } from "../stores/channels.js";
import { useHostsStore } from "../stores/hosts.js";
import { useWriteLockStore } from "../stores/writelock.js";
import { useLayout } from "./useLayout.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaletteItemType = "host" | "channel" | "action";

export interface PaletteItem {
	id: string;
	label: string;
	type: PaletteItemType;
	icon: string;
	shortcut?: string;
	/** Opaque payload used by execute() */
	payload?: unknown;
}

// ─── Module-level singleton state (one palette across the whole app) ──────────

const isOpen = ref(false);
const query = ref("");
const selectedIndex = ref(0);

// ─── Composable ───────────────────────────────────────────────────────────────

export function useCommandPalette() {
	const hostsStore = useHostsStore();
	const channelsStore = useChannelsStore();
	const writeLockStore = useWriteLockStore();
	const authStore = useAuthStore();
	const layout = useLayout();

	// ── Result computation ────────────────────────────────────────────────────

	const results = computed<PaletteItem[]>(() => {
		const q = query.value.trim().toLowerCase();

		const hostItems: PaletteItem[] = hostsStore.sortedHosts
			.filter((h) => q === "" || h.label.toLowerCase().includes(q))
			.map((h) => ({
				id: `host:${h.id}`,
				label: h.label,
				type: "host" as const,
				icon: "🖥",
				payload: h.id,
			}));

		const channelItems: PaletteItem[] = channelsStore.channels
			.filter((c) => q === "" || (c.title ?? "").toLowerCase().includes(q))
			.map((c) => ({
				id: `channel:${c.id}`,
				label: c.title ?? `Terminal ${c.id.slice(-8)}`,
				type: "channel" as const,
				icon: "📟",
				payload: c.id,
			}));

		// Determine current write-lock state for the active channel.
		// writeLockStore.isWriter is a Pinia-unwrapped computed — call it directly.
		const activeChannelId = channelsStore.selectedChannelId;
		const holdsLock = activeChannelId !== null && writeLockStore.isWriter(activeChannelId);

		const builtinActions: PaletteItem[] = (
			[
				{
					id: "action:new-channel",
					label: "New Channel",
					type: "action" as const,
					icon: "⊕",
					shortcut: "Ctrl+T",
				},
				{
					id: "action:split-right",
					label: "Split Right",
					type: "action" as const,
					icon: "⬌",
					shortcut: "Ctrl+\\",
				},
				{
					id: "action:split-down",
					label: "Split Down",
					type: "action" as const,
					icon: "⬍",
					shortcut: "Ctrl+-",
				},
				{
					id: "action:close-tab",
					label: "Close Tab",
					type: "action" as const,
					icon: "✕",
					shortcut: "Ctrl+W",
				},
				{
					id: "action:pairing-code",
					label: "Generate Pairing Code",
					type: "action" as const,
					icon: "🔗",
				},
				{
					id: "action:toggle-writelock",
					label: holdsLock ? "Release Write Lock" : "Claim Write Lock",
					type: "action" as const,
					icon: holdsLock ? "🔓" : "🔒",
				},
			] as PaletteItem[]
		).filter((a) => q === "" || a.label.toLowerCase().includes(q));

		return [...hostItems, ...channelItems, ...builtinActions];
	});

	// ── Navigation helpers ────────────────────────────────────────────────────

	function open(): void {
		isOpen.value = true;
		query.value = "";
		selectedIndex.value = 0;
	}

	function close(): void {
		isOpen.value = false;
		query.value = "";
		selectedIndex.value = 0;
	}

	function toggle(): void {
		if (isOpen.value) {
			close();
		} else {
			open();
		}
	}

	function search(q: string): void {
		query.value = q;
		selectedIndex.value = 0;
	}

	function moveUp(): void {
		if (results.value.length === 0) return;
		selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length;
	}

	function moveDown(): void {
		if (results.value.length === 0) return;
		selectedIndex.value = (selectedIndex.value + 1) % results.value.length;
	}

	// ── Execute ───────────────────────────────────────────────────────────────

	function execute(item: PaletteItem): void {
		close();

		switch (item.type) {
			case "host": {
				const hostId = item.payload as string;
				hostsStore.selectHost(hostId);
				break;
			}

			case "channel": {
				const channelId = item.payload as string;
				channelsStore.selectChannel(channelId);
				break;
			}

			case "action": {
				_executeAction(item.id);
				break;
			}
		}
	}

	function executeSelected(): void {
		const item = results.value[selectedIndex.value];
		if (item !== undefined) {
			execute(item);
		}
	}

	// ── Internal action dispatch ──────────────────────────────────────────────

	function _executeAction(actionId: string): void {
		const hostId = channelsStore.activeHostId;
		const activeChannelId = channelsStore.selectedChannelId;
		const activeTab = layout.activeTab.value;

		switch (actionId) {
			case "action:new-channel": {
				if (hostId === null) break;
				void channelsStore.spawnChannel(hostId).catch((err: unknown) => {
					console.error("[CommandPalette] new channel failed:", err);
				});
				break;
			}

			case "action:split-right": {
				if (activeChannelId === null || hostId === null) break;
				_spawnAndSplit(hostId, activeChannelId, "horizontal");
				break;
			}

			case "action:split-down": {
				if (activeChannelId === null || hostId === null) break;
				_spawnAndSplit(hostId, activeChannelId, "vertical");
				break;
			}

			case "action:close-tab": {
				if (activeTab === null) break;
				const idx = layout.tabs.value.findIndex((t) => t.channelId === activeTab.channelId);
				if (idx !== -1) layout.closeTab(idx);
				break;
			}

			case "action:pairing-code": {
				// Re-open pairing dialog by clearing the token.
				// The PairingScreen will appear and let the user generate a new code.
				authStore.clearToken();
				break;
			}

			case "action:toggle-writelock": {
				if (activeChannelId === null) break;
				const holdsLock = writeLockStore.isWriter(activeChannelId);
				if (holdsLock) {
					writeLockStore.release(activeChannelId);
				} else {
					writeLockStore.claim(activeChannelId);
				}
				break;
			}

			default:
				console.warn("[CommandPalette] unknown action:", actionId);
		}
	}

	function _spawnAndSplit(
		hostId: string,
		existingChannelId: string,
		direction: "horizontal" | "vertical",
	): void {
		void channelsStore
			.spawnChannel(hostId)
			.then((newChannelId) => {
				layout.splitPane(
					existingChannelId,
					direction,
					newChannelId,
					`Terminal ${newChannelId.slice(-8)}`,
				);
			})
			.catch((err: unknown) => {
				console.error("[CommandPalette] split spawn failed:", err);
			});
	}

	return {
		isOpen,
		query,
		results,
		selectedIndex,
		open,
		close,
		toggle,
		search,
		moveUp,
		moveDown,
		execute,
		executeSelected,
	};
}
