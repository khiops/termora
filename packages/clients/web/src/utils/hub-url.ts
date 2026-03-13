/**
 * Returns the base URL for hub API/WS calls.
 * In Tauri desktop, the hub runs as a separate sidecar on localhost:4100.
 * In web mode (dev or hub-served), relative URLs work via proxy or same-origin.
 */
export function hubBaseUrl(): string {
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		return "http://localhost:4100";
	}
	return "";
}

export function hubWsUrl(): string {
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		return "ws://localhost:4100";
	}
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}`;
}
