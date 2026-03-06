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

	/** Sorted hosts — local host always first, then alphabetical by label. */
	const sortedHosts = computed(() =>
		[...hosts.value].sort((a, b) => {
			if (a.type === "local" && b.type !== "local") return -1;
			if (a.type !== "local" && b.type === "local") return 1;
			return a.label.localeCompare(b.label);
		}),
	);

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
	};
});
