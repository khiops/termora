import type { Channel, ChannelGroup } from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import { defineStore } from "pinia";
import { computed, nextTick, ref } from "vue";
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
	 * Destroy a channel on the hub (kills its PTY) and remove it from the
	 * local sidebar. Best-effort: if the DELETE request fails the channel is
	 * still removed from the local list.
	 */
	async function removeChannel(channelId: string): Promise<void> {
		try {
			await fetch(`/api/channels/${channelId}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
		} catch {
			// Best-effort: even if DELETE fails (channel already dead, hub
			// unreachable), still remove from local sidebar below.
		}
		// Mark dead so the App.vue dead-channel watcher can close the tab
		const idx = channels.value.findIndex((c) => c.id === channelId);
		if (idx !== -1) {
			const existing = channels.value[idx];
			if (existing && existing.status !== "dead") {
				const next = [...channels.value];
				next[idx] = { ...existing, status: "dead" as const };
				channels.value = next;
			}
		}
		// Wait for watchers to process the status change (closes tab)
		await nextTick();
		// Then remove from sidebar list
		channels.value = channels.value.filter((c) => c.id !== channelId);
		if (selectedChannelId.value === channelId) {
			const fallback = channels.value.find((c) => c.status !== "dead");
			selectedChannelId.value = fallback?.id ?? null;
		}
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
	// Pending spawns: map tempId → hostId for deferred spawn flow
	// -------------------------------------------------------------------------

	const pendingSpawns = ref<Map<string, string>>(new Map());

	function registerPendingSpawn(tempId: string, hostId: string): void {
		const next = new Map(pendingSpawns.value);
		next.set(tempId, hostId);
		pendingSpawns.value = next;
	}

	function consumePendingSpawn(tempId: string): string | null {
		const hostId = pendingSpawns.value.get(tempId) ?? null;
		if (hostId !== null) {
			const next = new Map(pendingSpawns.value);
			next.delete(tempId);
			pendingSpawns.value = next;
		}
		return hostId;
	}

	// -------------------------------------------------------------------------
	// WS: spawn a new channel on a host
	// -------------------------------------------------------------------------

	function spawnChannel(
		hostId: string,
		opts?: { cols?: number; rows?: number; select?: boolean },
	): Promise<string> {
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
					void fetchChannels(hostId);
					if (opts?.select !== false) {
						selectChannel(msg.channelId);
					}
					resolve(msg.channelId);
				}
			});

			sessionStore.wsClient.send({
				type: "SPAWN",
				hostId,
				...(opts?.cols !== undefined && opts?.rows !== undefined
					? { cols: opts.cols, rows: opts.rows }
					: {}),
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

	/**
	 * Rename a channel (optimistic update with rollback on failure).
	 * Pass `null` to clear the custom title.
	 */
	async function renameChannel(channelId: string, title: string | null): Promise<void> {
		const idx = channels.value.findIndex((c) => c.id === channelId);
		if (idx === -1) return;
		const existing = channels.value[idx];
		if (existing === undefined) return;
		const oldChannel = existing;

		// Optimistic update — rebuild to satisfy exactOptionalPropertyTypes
		const { title: _removed, ...rest } = existing;
		const updated: Channel = title !== null ? { ...rest, title } : (rest as Channel);
		const next = [...channels.value];
		next[idx] = updated;
		channels.value = next;

		try {
			const res = await fetch(`/api/channels/${channelId}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${authStore.token}`,
				},
				body: JSON.stringify({ title }),
			});
			if (!res.ok) throw new Error("Failed to rename");
		} catch {
			// Rollback
			const rollbackIdx = channels.value.findIndex((c) => c.id === channelId);
			if (rollbackIdx !== -1) {
				const rollback = [...channels.value];
				rollback[rollbackIdx] = oldChannel;
				channels.value = rollback;
			}
			if (activeHostId.value !== null) {
				await fetchChannels(activeHostId.value);
			}
		}
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
		removeChannel,
		addChannel,
		spawnChannel,
		registerPendingSpawn,
		consumePendingSpawn,
		addGroup,
		removeGroup,
		renameGroup,
		toggleGroupCollapsed,
		renameChannel,
		moveChannelToGroup,
	};
});
