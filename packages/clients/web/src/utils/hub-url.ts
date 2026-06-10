/**
 * Returns the base URL for hub API/WS calls.
 * In Tauri desktop, the hub runs as a separate sidecar on a dynamic port
 * (resolved at startup via runtime.json). Call initHubPort() once at app
 * startup to cache the port before any API calls are made.
 * In web mode (dev or hub-served), relative URLs work via proxy or same-origin.
 */

import { readonly, ref } from "vue";

let _cachedPort: number | null = null;
let _assetToken: string | null = null;
const _hubPortReady = ref(false);
const _assetTokenReady = ref(false);
const ASSET_TOKEN_QUERY_PARAM = "asset_token";

export const hubPortReady = readonly(_hubPortReady);
export const assetTokenReady = readonly(_assetTokenReady);

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

export async function initAssetToken(authToken: string | null): Promise<void> {
	const response = await fetch(`${hubBaseUrl()}/api/assets/token`, {
		...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
	});
	if (!response.ok) {
		throw new Error(`Failed to load asset token: ${response.status}`);
	}
	const body = (await response.json()) as { assetToken?: string; token?: string };
	const token = body.assetToken ?? body.token ?? null;
	if (!token) throw new Error("Asset token response missing token");
	_assetToken = token;
	_assetTokenReady.value = true;
}

export function clearAssetToken(): void {
	_assetToken = null;
	_assetTokenReady.value = false;
}

export function setAssetTokenForTests(token: string | null): void {
	_assetToken = token;
	_assetTokenReady.value = token !== null;
}

function localOrigin(): string {
	if (typeof window !== "undefined" && window.location?.origin) {
		return window.location.origin;
	}
	return "http://localhost";
}

export function publicAssetUrl(
	pathOrUrl: string,
	extraParams?: Record<string, number | string | null | undefined>,
): string {
	const isAbsolute = /^[a-z][a-z\d+\-.]*:\/\//i.test(pathOrUrl);
	const hubBase = hubBaseUrl();
	const base = isAbsolute ? undefined : hubBase || localOrigin();
	const url = new URL(pathOrUrl, base);

	if (_assetToken) {
		url.searchParams.set(ASSET_TOKEN_QUERY_PARAM, _assetToken);
	}
	if (extraParams) {
		for (const [key, value] of Object.entries(extraParams)) {
			if (value === null || value === undefined) continue;
			url.searchParams.set(key, String(value));
		}
	}

	if (isAbsolute) return url.toString();
	return `${hubBase}${url.pathname}${url.search}${url.hash}`;
}

export function namedPublicAssetUrl(
	kind: "fonts" | "sounds" | "wallpapers",
	filename: string,
	extraParams?: Record<string, number | string | null | undefined>,
): string {
	return publicAssetUrl(`/public/${kind}/${encodeURIComponent(filename)}`, extraParams);
}
