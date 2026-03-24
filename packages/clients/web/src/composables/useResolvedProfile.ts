
import { ref, onMounted, onUnmounted, type Ref } from "vue";
import { DEFAULT_PROFILE, type TerminalProfile } from "@nexterm/shared";
import { useConfigStore } from "../stores/config.js";
import { useAuthStore } from "../stores/auth.js";
import { hubBaseUrl } from "../utils/hub-url.js";

/**
 * Per-terminal profile resolution via the cascade API.
 *
 * Fetches /api/config/resolved?host_id=X&channel_id=Y on mount and
 * re-fetches whenever a relevant profile-change event fires (global,
 * host-scoped matching hostId, or channel-scoped matching channelId).
 *
 * Falls back to DEFAULT_PROFILE while the first fetch is in-flight or
 * if the request fails.
 */
export function useResolvedProfile(
	hostId: Ref<string | undefined | null>,
	channelId: Ref<string | undefined | null>,
): { profile: Ref<TerminalProfile>; reload: () => Promise<void> } {
	const configStore = useConfigStore();
	const authStore = useAuthStore();
	const profile = ref<TerminalProfile>({ ...DEFAULT_PROFILE });

	async function reload(): Promise<void> {
		try {
			const params = new URLSearchParams();
			if (hostId.value) params.set("host_id", hostId.value);
			if (channelId.value) params.set("channel_id", channelId.value);
			const qs = params.toString();
			const resp = await fetch(
				`${hubBaseUrl()}/api/config/resolved${qs ? `?${qs}` : ""}`,
				{ headers: { Authorization: `Bearer ${authStore.token}` } },
			);
			if (resp.ok) {
				profile.value = (await resp.json()) as TerminalProfile;
			}
		} catch (err) {
			console.warn("[useResolvedProfile] failed to load:", err);
		}
	}

	let unsubscribe: (() => void) | null = null;

	onMounted(() => {
		reload();
		unsubscribe = configStore.onProfileChange((event) => {
			if (event.scope === "global") {
				// Global change affects all terminals
				reload();
			} else if (event.scope === "host" && event.hostId === hostId.value) {
				// Host change affects terminals on this host
				reload();
			} else if (event.scope === "channel" && event.channelId === channelId.value) {
				// Channel change affects only this terminal
				reload();
			}
		});
	});

	onUnmounted(() => {
		unsubscribe?.();
	});

	return { profile, reload };
}
