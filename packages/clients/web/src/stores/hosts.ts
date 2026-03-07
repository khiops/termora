import type { Host, SessionStatus } from "@nexterm/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useAuthStore } from "./auth.js";

/** Derived per-host connectivity status rendered in the rail status dot. */
export type HostStatus = "live" | "offline" | "error" | "reconnecting";

/**
 * Map a raw SessionStatus value (or absence thereof) to the four visual states
 * shown in the host rail badge dot.
 */
function sessionStatusToHostStatus(status: SessionStatus | undefined): HostStatus {
	if (status === undefined) return "offline";
	switch (status) {
		case "active":
			return "live";
		case "detached":
			return "live";
		case "starting":
			return "reconnecting";
		case "disconnected":
			return "error";
		case "closed":
			return "offline";
	}
}

export const useHostsStore = defineStore("hosts", () => {
	const authStore = useAuthStore();

	const hosts = ref<Host[]>([]);
	const selectedHostId = ref<string | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	/**
	 * Per-host session statuses received via SESSION_STATE WebSocket messages.
	 * Key = hostId, value = most-recent SessionStatus for that host.
	 */
	const _sessionStatuses = ref<Map<string, SessionStatus>>(new Map());

	/**
	 * Sorted hosts — server already returns them in the correct order
	 * (local first, then by group/sort_order).
	 */
	const sortedHosts = computed(() => hosts.value);

	async function fetchHosts(): Promise<void> {
		if (authStore.token === null) return;
		loading.value = true;
		error.value = null;
		try {
			const res = await fetch("/api/hosts", {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
			if (!res.ok) {
				throw new Error(`GET /api/hosts failed: ${res.status}`);
			}
			const data = (await res.json()) as Host[];
			hosts.value = data;
			// Auto-select the first host if nothing is selected yet
			if (selectedHostId.value === null && data.length > 0) {
				selectedHostId.value = data[0]?.id ?? null;
			}
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	}

	function selectHost(hostId: string): void {
		selectedHostId.value = hostId;
	}

	/**
	 * Update the cached session status for a host.
	 * Called by the session store whenever a SESSION_STATE message arrives.
	 */
	function updateSessionStatus(hostId: string, status: SessionStatus): void {
		_sessionStatuses.value.set(hostId, status);
		// Trigger Vue reactivity on the Map by replacing the ref value
		_sessionStatuses.value = new Map(_sessionStatuses.value);
	}

	function getHostStatus(hostId: string): HostStatus {
		return sessionStatusToHostStatus(_sessionStatuses.value.get(hostId));
	}

	async function reorderHosts(group: string | null, hostIds: string[]): Promise<void> {
		await fetch("/api/hosts/reorder", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authStore.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ group, host_ids: hostIds }),
		});
		// Update local state optimistically
		for (let i = 0; i < hostIds.length; i++) {
			const host = hosts.value.find((h) => h.id === hostIds[i]);
			if (host) {
				host.sortOrder = i;
				host.hostGroup = group ?? null;
			}
		}
	}

	async function createHost(body: Record<string, unknown>): Promise<Host | null> {
		const res = await fetch("/api/hosts", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authStore.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) return null;
		const host = (await res.json()) as Host;
		hosts.value = [...hosts.value, host];
		return host;
	}

	async function updateHost(id: string, body: Record<string, unknown>): Promise<Host | null> {
		const res = await fetch(`/api/hosts/${id}`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authStore.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) return null;
		const updated = (await res.json()) as Host;
		const idx = hosts.value.findIndex((h) => h.id === id);
		if (idx >= 0) hosts.value[idx] = updated;
		return updated;
	}

	async function deleteHost(id: string): Promise<boolean> {
		const res = await fetch(`/api/hosts/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		if (!res.ok) return false;
		hosts.value = hosts.value.filter((h) => h.id !== id);
		if (selectedHostId.value === id) {
			selectedHostId.value = hosts.value[0]?.id ?? null;
		}
		return true;
	}

	async function duplicateHost(id: string): Promise<Host | null> {
		const res = await fetch(`/api/hosts/${id}/duplicate`, {
			method: "POST",
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		if (!res.ok) return null;
		const host = (await res.json()) as Host;
		hosts.value = [...hosts.value, host];
		return host;
	}

	async function testConnection(id: string): Promise<{ ok: boolean; message?: string }> {
		const res = await fetch(`/api/hosts/${id}/test`, {
			method: "POST",
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		return (await res.json()) as { ok: boolean; message?: string };
	}

	function getHostGroups(): string[] {
		const groups = new Set<string>();
		for (const host of hosts.value) {
			if (host.hostGroup) groups.add(host.hostGroup);
		}
		return [...groups].sort();
	}

	return {
		hosts,
		sortedHosts,
		selectedHostId,
		loading,
		error,
		fetchHosts,
		selectHost,
		updateSessionStatus,
		getHostStatus,
		reorderHosts,
		createHost,
		updateHost,
		deleteHost,
		duplicateHost,
		testConnection,
		getHostGroups,
	};
});
