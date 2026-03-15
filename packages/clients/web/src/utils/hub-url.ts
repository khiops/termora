/**
 * Returns the base URL for hub API/WS calls.
 * In Tauri desktop, the hub runs as a separate sidecar on a dynamic port
 * (resolved at startup via runtime.json). Call initHubPort() once at app
 * startup to cache the port before any API calls are made.
 * In web mode (dev or hub-served), relative URLs work via proxy or same-origin.
 */

let _cachedPort: number | null = null;

async function getHubPort(): Promise<number> {
	if (_cachedPort !== null) return _cachedPort;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		_cachedPort = await invoke<number>("get_hub_port");
		return _cachedPort;
	} catch {
		return 4100; // fallback for non-Tauri context
	}
}

export function hubBaseUrl(): string {
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		return `http://localhost:${_cachedPort ?? 4100}`;
	}
	return "";
}

export function hubWsUrl(): string {
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		return `ws://localhost:${_cachedPort ?? 4100}`;
	}
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}`;
}

/** Call once at app startup to cache the hub port from the Tauri invoke. */
export async function initHubPort(): Promise<void> {
	await getHubPort();
}
