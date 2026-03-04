import type { Channel, ChannelGroup } from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useAuthStore } from "./auth.js";
import { useSessionStore } from "./session.js";

const GROUPS_KEY = "nexterm:channel-groups";

function loadGroupsFromStorage(): ChannelGroup[] {
	try {
		const raw = localStorage.getItem(GROUPS_KEY);
		if (raw === null) return [];
		return JSON.parse(raw) as ChannelGroup[];
	} catch {
		return [];
	}
}

function saveGroupsToStorage(groups: ChannelGroup[]): void {
	localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

/**
 * Channel store — manages channel list, groups, selection, and unread state.
 *
 * Groups are persisted to localStorage (REST endpoint for groups is a future
 * enhancement per the spec). Channels are fetched from GET /api/channels.
 *
 * CHANNEL_STATE WebSocket messages update channel status in real time.
 */
export const useChannelsStore = defineStore("channels", () => {
	const authStore = useAuthStore();

	const channels = ref<Channel[]>([]);
	const groups = ref<ChannelGroup[]>(loadGroupsFromStorage());
	const selectedChannelId = ref<string | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	/**
	 * Set of channel IDs that have received new output since the user last
	 * viewed them. Used to render the unread indicator dot.
	 */
	const unreadChannels = ref<Set<string>>(new Set());

	/** Channels that belong to the currently loaded host. */
	const activeHostId = ref<string | null>(null);

	/** Channels grouped by groupId, with an implicit "General" bucket for ungrouped ones. */
	const channelsByGroup = computed(() => {
		const result = new Map<string | null, Channel[]>();
		result.set(null, []); // null = ungrouped (rendered as "General")

		// Pre-populate group buckets in sort order
		for (const g of groups.value) {
			result.set(g.id, []);
		}

		for (const ch of channels.value) {
			const gid = ch.groupId ?? null;
			if (!result.has(gid)) {
				// Group was deleted — fall back to ungrouped
				result.get(null)?.push(ch);
			} else {
				result.get(gid)?.push(ch);
			}
		}

		return result;
	});

	// -------------------------------------------------------------------------
	// REST: fetch channels for a host
	// -------------------------------------------------------------------------

	async function fetchChannels(hostId: string): Promise<void> {
		if (authStore.token === null) return;
		loading.value = true;
		error.value = null;
		activeHostId.value = hostId;
		try {
			const res = await fetch(`/api/channels?host_id=${encodeURIComponent(hostId)}`, {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
			if (!res.ok) {
				throw new Error(`GET /api/channels failed: ${res.status}`);
			}
			const data = (await res.json()) as Channel[];
			channels.value = data;
			// Clear selection if the previously selected channel is no longer
			// present (e.g. host switched)
			if (selectedChannelId.value !== null) {
				const still = data.find((c) => c.id === selectedChannelId.value);
				if (!still) selectedChannelId.value = null;
			}
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	}

	// -------------------------------------------------------------------------
	// Selection
	// -------------------------------------------------------------------------

	function selectChannel(channelId: string): void {
		selectedChannelId.value = channelId;
		// Clear unread on selection
		if (unreadChannels.value.has(channelId)) {
			const next = new Set(unreadChannels.value);
			next.delete(channelId);
			unreadChannels.value = next;
		}
	}

	// -------------------------------------------------------------------------
	// Unread tracking
	// -------------------------------------------------------------------------

	function markUnread(channelId: string): void {
		// Don't mark unread the channel currently being viewed
		if (channelId === selectedChannelId.value) return;
		const next = new Set(unreadChannels.value);
		next.add(channelId);
		unreadChannels.value = next;
	}

	// -------------------------------------------------------------------------
	// Real-time channel state updates from CHANNEL_STATE WS messages
	// -------------------------------------------------------------------------

	function updateChannelStatus(
		channelId: string,
		status: Channel["status"],
		exitCode?: number,
	): void {
		const idx = channels.value.findIndex((c) => c.id === channelId);
		if (idx === -1) return;
		const existing = channels.value[idx];
		if (existing === undefined) return;
		const updated = { ...existing };
		updated.status = status;
		if (exitCode !== undefined) updated.exitCode = exitCode;
		const next = [...channels.value];
		next[idx] = updated;
		channels.value = next;
	}

	/**
	 * Called when a SPAWN_OK arrives so the new channel appears immediately
	 * without requiring a full refetch.
	 */
	function addChannel(channel: Channel): void {
		// Avoid duplicates if REST fetch races with WS event
		if (channels.value.some((c) => c.id === channel.id)) return;
		channels.value = [...channels.value, channel];
	}

	// -------------------------------------------------------------------------
	// WS: spawn a new channel on the active host
	// -------------------------------------------------------------------------

	function spawnChannel(hostId: string): Promise<string> {
		const sessionStore = useSessionStore();
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				unsub();
				reject(new Error("SPAWN timeout — no SPAWN_OK after 10s"));
			}, 10_000);

			const unsub = sessionStore.wsClient.on("SPAWN_OK", (msg) => {
				if (msg.type === "SPAWN_OK") {
					clearTimeout(timer);
					unsub();
					// Add channel optimistically; fetchChannels will reconcile
					void fetchChannels(hostId);
					selectChannel(msg.channelId);
					resolve(msg.channelId);
				}
			});

			sessionStore.wsClient.send({
				type: "SPAWN",
				hostId,
			});
		});
	}

	// -------------------------------------------------------------------------
	// Group management (localStorage-persisted)
	// -------------------------------------------------------------------------

	function addGroup(name: string): ChannelGroup {
		const now = new Date().toISOString();
		const group: ChannelGroup = {
			id: generateId(),
			hostId: activeHostId.value ?? "",
			name,
			sortOrder: groups.value.length,
			collapsed: false,
			createdAt: now,
		};
		const next = [...groups.value, group];
		groups.value = next;
		saveGroupsToStorage(next);
		return group;
	}

	function removeGroup(groupId: string): void {
		// Move channels in this group to ungrouped by omitting the groupId key
		channels.value = channels.value.map((ch) => {
			if (ch.groupId !== groupId) return ch;
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { groupId: _removed, ...rest } = ch;
			return rest as Channel;
		});
		const next = groups.value.filter((g) => g.id !== groupId);
		groups.value = next;
		saveGroupsToStorage(next);
	}

	function renameGroup(groupId: string, name: string): void {
		const next = groups.value.map((g) => (g.id === groupId ? { ...g, name } : g));
		groups.value = next;
		saveGroupsToStorage(next);
	}

	function toggleGroupCollapsed(groupId: string): void {
		const next = groups.value.map((g) =>
			g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
		);
		groups.value = next;
		saveGroupsToStorage(next);
	}

	function moveChannelToGroup(channelId: string, groupId: string | null): void {
		channels.value = channels.value.map((ch) => {
			if (ch.id !== channelId) return ch;
			if (groupId === null) {
				// Remove groupId key entirely to satisfy exactOptionalPropertyTypes
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { groupId: _removed, ...rest } = ch;
				return rest as Channel;
			}
			return { ...ch, groupId };
		});
	}

	return {
		channels,
		groups,
		selectedChannelId,
		loading,
		error,
		unreadChannels,
		activeHostId,
		channelsByGroup,
		fetchChannels,
		selectChannel,
		markUnread,
		updateChannelStatus,
		addChannel,
		spawnChannel,
		addGroup,
		removeGroup,
		renameGroup,
		toggleGroupCollapsed,
		moveChannelToGroup,
	};
});
