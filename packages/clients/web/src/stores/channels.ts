import type { Channel, ChannelGroup } from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import { defineStore } from "pinia";
import { computed, nextTick, ref } from "vue";
import { useAuthStore } from "./auth.js";
import { useSessionStore } from "./session.js";

const COLLAPSED_KEY = "nexterm:collapsed-groups";

function loadCollapsedMap(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(COLLAPSED_KEY);
		if (raw === null) return {};
		return JSON.parse(raw) as Record<string, boolean>;
	} catch {
		return {};
	}
}

function saveCollapsedMap(map: Record<string, boolean>): void {
	localStorage.setItem(COLLAPSED_KEY, JSON.stringify(map));
}

/** Convert a snake_case channel row from the API to a camelCase Channel. */
function apiRowToChannel(row: Record<string, unknown>): Channel {
	const ch: Channel = {
		id: row.id as string,
		sessionId: row.session_id as string,
		shell: row.shell as string,
		cols: row.cols as number,
		rows: row.rows as number,
		status: row.status as Channel["status"],
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
	if (row.group_id != null) ch.groupId = row.group_id as string;
	if (row.title != null) ch.title = row.title as string;
	if (row.cwd != null) ch.cwd = row.cwd as string;
	if (row.env_json != null) ch.envJson = row.env_json as string;
	if (row.exit_code != null) ch.exitCode = row.exit_code as number;
	if (row.profile_json != null) ch.profileJson = row.profile_json as string;
	return ch;
}

/** Convert a snake_case group row from the API to a camelCase ChannelGroup. */
function apiGroupToChannelGroup(
	row: Record<string, unknown>,
	collapsedMap: Record<string, boolean>,
): ChannelGroup {
	return {
		id: row.id as string,
		hostId: row.host_id as string,
		name: row.name as string,
		sortOrder: row.sort_order as number,
		collapsed: collapsedMap[row.id as string] ?? false,
		createdAt: row.created_at as string,
	};
}

/**
 * Channel store — manages channel list, groups, selection, and unread state.
 *
 * Groups are fetched from / persisted via the REST API (GET/POST/PATCH/DELETE
 * /api/groups). The `collapsed` state is UI-only and stored in localStorage.
 * Channels are fetched from GET /api/channels.
 *
 * CHANNEL_STATE WebSocket messages update channel status in real time.
 */
export const useChannelsStore = defineStore("channels", () => {
	const authStore = useAuthStore();

	const channels = ref<Channel[]>([]);
	const groups = ref<ChannelGroup[]>([]);
	const selectedChannelId = ref<string | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	/**
	 * Set of channel IDs that have received new output since the user last
	 * viewed them. Used to render the unread indicator dot.
	 */
	const unreadChannels = ref<Set<string>>(new Set());

	/** Buffered channel status updates from WS that arrived before fetchChannels populated the list. */
	const pendingStatuses = ref<Map<string, { status: Channel["status"]; exitCode?: number }>>(
		new Map(),
	);

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
	// REST: fetch groups for a host
	// -------------------------------------------------------------------------

	async function fetchGroups(hostId: string): Promise<void> {
		if (authStore.token === null) return;
		const res = await fetch(`/api/groups?host_id=${encodeURIComponent(hostId)}`, {
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		if (!res.ok) {
			throw new Error(`GET /api/groups failed: ${res.status}`);
		}
		const rows = (await res.json()) as Record<string, unknown>[];
		const collapsedMap = loadCollapsedMap();
		groups.value = rows.map((r) => apiGroupToChannelGroup(r, collapsedMap));
	}

	// -------------------------------------------------------------------------
	// REST: fetch channels for a host
	// -------------------------------------------------------------------------

	async function fetchChannels(hostId: string): Promise<void> {
		if (authStore.token === null) return;
		loading.value = true;
		error.value = null;
		activeHostId.value = hostId;
		try {
			const [channelsRes] = await Promise.all([
				fetch(`/api/channels?host_id=${encodeURIComponent(hostId)}`, {
					headers: { Authorization: `Bearer ${authStore.token}` },
				}),
				fetchGroups(hostId),
			]);
			if (!channelsRes.ok) {
				throw new Error(`GET /api/channels failed: ${channelsRes.status}`);
			}
			const rows = (await channelsRes.json()) as Record<string, unknown>[];
			const data = rows.map(apiRowToChannel);
			channels.value = data;
			// Apply any WS status updates that arrived before the fetch completed
			if (pendingStatuses.value.size > 0) {
				const pending = pendingStatuses.value;
				pendingStatuses.value = new Map();
				let statusUpdated = false;
				const merged = data.map((ch) => {
					const p = pending.get(ch.id);
					if (p) {
						statusUpdated = true;
						return {
							...ch,
							status: p.status,
							...(p.exitCode !== undefined && { exitCode: p.exitCode }),
						};
					}
					return ch;
				});
				if (statusUpdated) {
					channels.value = merged;
				}
			}
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
		if (idx === -1) {
			// Channel not loaded yet — buffer for later application
			const next = new Map(pendingStatuses.value);
			next.set(channelId, { status, ...(exitCode !== undefined && { exitCode }) });
			pendingStatuses.value = next;
			return;
		}
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
	 * Apply a batch of channel statuses from a STATE_SYNC message.
	 * If channels are loaded, updates them directly. Otherwise buffers for later.
	 */
	function applyStateSync(
		syncChannels: Array<{
			channelId: string;
			sessionId: string;
			status: Channel["status"];
			exitCode?: number;
		}>,
	): void {
		if (channels.value.length === 0) {
			// Channels not loaded yet — buffer all
			const next = new Map(pendingStatuses.value);
			for (const sc of syncChannels) {
				next.set(sc.channelId, {
					status: sc.status,
					...(sc.exitCode !== undefined && { exitCode: sc.exitCode }),
				});
			}
			pendingStatuses.value = next;
			return;
		}
		// Channels loaded — apply directly
		let changed = false;
		const updated = channels.value.map((ch) => {
			const sc = syncChannels.find((s) => s.channelId === ch.id);
			if (sc && ch.status !== sc.status) {
				changed = true;
				return {
					...ch,
					status: sc.status,
					...(sc.exitCode !== undefined && { exitCode: sc.exitCode }),
				};
			}
			return ch;
		});
		if (changed) {
			channels.value = updated;
		}
		// Buffer statuses for channels not yet loaded
		const loadedIds = new Set(channels.value.map((c) => c.id));
		const next = new Map(pendingStatuses.value);
		for (const sc of syncChannels) {
			if (!loadedIds.has(sc.channelId)) {
				next.set(sc.channelId, {
					status: sc.status,
					...(sc.exitCode !== undefined && { exitCode: sc.exitCode }),
				});
			}
		}
		if (next.size > 0) {
			pendingStatuses.value = next;
		}
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
	// Group management (REST API + localStorage for collapsed state)
	// -------------------------------------------------------------------------

	async function addGroup(name: string): Promise<ChannelGroup> {
		if (authStore.token === null) throw new Error("Not authenticated");
		const hostId = activeHostId.value;
		if (hostId === null) throw new Error("No active host");

		const res = await fetch("/api/groups", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authStore.token}`,
			},
			body: JSON.stringify({ host_id: hostId, name }),
		});
		if (!res.ok) throw new Error(`POST /api/groups failed: ${res.status}`);

		const row = (await res.json()) as Record<string, unknown>;
		const collapsedMap = loadCollapsedMap();
		const group = apiGroupToChannelGroup(row, collapsedMap);
		groups.value = [...groups.value, group];
		return group;
	}

	async function removeGroup(groupId: string): Promise<void> {
		if (authStore.token === null) return;

		await fetch(`/api/groups/${groupId}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${authStore.token}` },
		});

		// Update local channels — clear groupId for channels in the deleted group
		channels.value = channels.value.map((ch) => {
			if (ch.groupId !== groupId) return ch;
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { groupId: _removed, ...rest } = ch;
			return rest as Channel;
		});

		// Remove group locally and clean up collapsed state
		groups.value = groups.value.filter((g) => g.id !== groupId);
		const collapsedMap = loadCollapsedMap();
		delete collapsedMap[groupId];
		saveCollapsedMap(collapsedMap);
	}

	async function renameGroup(groupId: string, name: string): Promise<void> {
		if (authStore.token === null) return;

		// Optimistic update
		const oldGroups = groups.value;
		groups.value = groups.value.map((g) => (g.id === groupId ? { ...g, name } : g));

		try {
			const res = await fetch(`/api/groups/${groupId}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${authStore.token}`,
				},
				body: JSON.stringify({ name }),
			});
			if (!res.ok) throw new Error(`PATCH /api/groups/${groupId} failed: ${res.status}`);
		} catch {
			// Rollback
			groups.value = oldGroups;
		}
	}

	function toggleGroupCollapsed(groupId: string): void {
		groups.value = groups.value.map((g) =>
			g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
		);
		// Persist collapsed state to localStorage
		const collapsedMap = loadCollapsedMap();
		const group = groups.value.find((g) => g.id === groupId);
		if (group) {
			collapsedMap[groupId] = group.collapsed;
		}
		saveCollapsedMap(collapsedMap);
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

	async function moveChannelToGroup(channelId: string, groupId: string | null): Promise<void> {
		if (authStore.token === null) return;

		// Optimistic update
		const oldChannels = channels.value;
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

		try {
			const res = await fetch(`/api/channels/${channelId}`, {
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${authStore.token}`,
				},
				body: JSON.stringify({ group_id: groupId }),
			});
			if (!res.ok) throw new Error(`PATCH /api/channels/${channelId} failed: ${res.status}`);
		} catch {
			// Rollback
			channels.value = oldChannels;
		}
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
		fetchGroups,
		fetchChannels,
		selectChannel,
		markUnread,
		updateChannelStatus,
		applyStateSync,
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
