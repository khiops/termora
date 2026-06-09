/**
 * Returns the base URL for hub API/WS calls.
 * In Tauri desktop, the hub runs as a separate sidecar on a dynamic port
 * (resolved at startup via runtime.json). Call initHubPort() once at app
 * startup to cache the port before any API calls are made.
 * In web mode (dev or hub-served), relative URLs work via proxy or same-origin.
 */

import { readonly, ref } from "vue";

let _cachedPort: number | null = null;
const _hubPortReady = ref(false);

export const hubPortReady = readonly(_hubPortReady);

function isTauriRuntime(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getHubPort(): Promise<number> {
	if (_cachedPort !== null) return _cachedPort;
	if (!isTauriRuntime()) return 4100;
	const { invoke } = await import("@tauri-apps/api/core");
	_cachedPort = await invoke<number>("get_hub_port");
	return _cachedPort;
}

export function hubBaseUrl(): string {
	if (isTauriRuntime()) {
		return `http://localhost:${_cachedPort ?? 4100}`;
	}
	return "";
}

export function hubWsUrl(): string {
	if (isTauriRuntime()) {
		return `ws://localhost:${_cachedPort ?? 4100}`;
	}
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}`;
}

/** Call once at app startup to cache the hub port from the Tauri invoke. */
export async function initHubPort(): Promise<void> {
	await getHubPort();
	_hubPortReady.value = true;
}
