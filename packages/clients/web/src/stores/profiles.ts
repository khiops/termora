import type { LaunchProfile } from "@nexterm/shared";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useAuthStore } from "./auth.js";
import { useChannelsStore } from "./channels.js";
import { useSessionStore } from "./session.js";

/**
 * Profiles store — manages launch profiles.
 *
 * Profiles are fetched from GET /api/launch-profiles (all) or
 * GET /api/hosts/:id/profiles (host-filtered, respects overrides).
 * Spawn happens via WebSocket SPAWN message with launchProfileId or
 * inline shell/args for quick commands.
 */
export const useProfilesStore = defineStore("profiles", () => {
	const authStore = useAuthStore();

	const profiles = ref<LaunchProfile[]>([]);
	const loading = ref(false);

	// -------------------------------------------------------------------------
	// REST: fetch all profiles
	// -------------------------------------------------------------------------

	async function fetchProfiles(): Promise<void> {
		if (authStore.token === null) return;
		loading.value = true;
		try {
			const res = await fetch("/api/launch-profiles", {
				headers: { Authorization: `Bearer ${authStore.token}` },
			});
			if (!res.ok) throw new Error(`GET /api/launch-profiles failed: ${res.status}`);
			profiles.value = (await res.json()) as LaunchProfile[];
		} finally {
			loading.value = false;
		}
	}

	// -------------------------------------------------------------------------
	// REST: fetch host-visible profiles (filtered + overridden)
	// -------------------------------------------------------------------------

	async function fetchHostProfiles(hostId: string): Promise<LaunchProfile[]> {
		if (authStore.token === null) return [];
		const res = await fetch(`/api/hosts/${encodeURIComponent(hostId)}/profiles`, {
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		if (!res.ok) throw new Error(`GET /api/hosts/${hostId}/profiles failed: ${res.status}`);
		return (await res.json()) as LaunchProfile[];
	}

	// -------------------------------------------------------------------------
	// REST: CRUD
	// -------------------------------------------------------------------------

	async function createProfile(data: Partial<LaunchProfile>): Promise<LaunchProfile> {
		if (authStore.token === null) throw new Error("Not authenticated");
		const res = await fetch("/api/launch-profiles", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authStore.token}`,
			},
			body: JSON.stringify(data),
		});
		if (!res.ok) throw new Error(`POST /api/launch-profiles failed: ${res.status}`);
		const created = (await res.json()) as LaunchProfile;
		profiles.value = [...profiles.value, created];
		return created;
	}

	async function updateProfile(id: string, data: Partial<LaunchProfile>): Promise<LaunchProfile> {
		if (authStore.token === null) throw new Error("Not authenticated");
		const res = await fetch(`/api/launch-profiles/${encodeURIComponent(id)}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authStore.token}`,
			},
			body: JSON.stringify(data),
		});
		if (!res.ok) throw new Error(`PATCH /api/launch-profiles/${id} failed: ${res.status}`);
		const updated = (await res.json()) as LaunchProfile;
		profiles.value = profiles.value.map((p) => (p.id === id ? updated : p));
		return updated;
	}

	async function deleteProfile(id: string): Promise<void> {
		if (authStore.token === null) throw new Error("Not authenticated");
		const res = await fetch(`/api/launch-profiles/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${authStore.token}` },
		});
		if (!res.ok) throw new Error(`DELETE /api/launch-profiles/${id} failed: ${res.status}`);
		profiles.value = profiles.value.filter((p) => p.id !== id);
	}

	async function reorderProfiles(ids: string[]): Promise<void> {
		if (authStore.token === null) return;
		const res = await fetch("/api/launch-profiles/reorder", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authStore.token}`,
			},
			body: JSON.stringify({ ids }),
		});
		if (!res.ok) throw new Error(`PUT /api/launch-profiles/reorder failed: ${res.status}`);
	}

	// -------------------------------------------------------------------------
	// WS: spawn from profile
	// -------------------------------------------------------------------------

	/**
	 * Spawn a terminal using the given launch profile.
	 * Sends SPAWN with launchProfileId — the hub resolves shell/args/env
	 * from the profile at spawn time.
	 */
	function spawnFromProfile(profileId: string): void {
		const channelsStore = useChannelsStore();
		const sessionStore = useSessionStore();

		const hostId = channelsStore.activeHostId;
		if (hostId === null) return;

		sessionStore.wsClient.send({
			type: "SPAWN",
			hostId,
			launchProfileId: profileId,
		});
	}

	/**
	 * Spawn a one-off command (process mode).
	 * Parses the command string: first token is shell/command, rest are args.
	 * Empty input is a no-op.
	 */
	function spawnQuickCommand(command: string): void {
		const trimmed = command.trim();
		if (trimmed === "") return;

		const channelsStore = useChannelsStore();
		const sessionStore = useSessionStore();

		const hostId = channelsStore.activeHostId;
		if (hostId === null) return;

		const parts = trimmed.split(/\s+/);
		const shell = parts[0] as string;
		const args = parts.slice(1);

		sessionStore.wsClient.send({
			type: "SPAWN",
			hostId,
			shell,
			...(args.length > 0 ? { args } : {}),
			directProcess: true,
		});
	}

	return {
		profiles,
		loading,
		fetchProfiles,
		fetchHostProfiles,
		createProfile,
		updateProfile,
		deleteProfile,
		reorderProfiles,
		spawnFromProfile,
		spawnQuickCommand,
	};
});
