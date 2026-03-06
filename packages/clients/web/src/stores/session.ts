import { generateId } from "@nexterm/shared";
import { defineStore } from "pinia";
import { markRaw, ref } from "vue";
import { WsClient } from "../services/ws-client.js";
import { useAuthStore } from "./auth.js";
import { useChannelsStore } from "./channels.js";
import { useConfigStore } from "./config.js";
import { useHostsStore } from "./hosts.js";
import { useWriteLockStore } from "./writelock.js";

export const useSessionStore = defineStore("session", () => {
	// markRaw: prevent Pinia/Vue from making WsClient reactive,
	// which would strip private class members and break the class methods.
	const wsClient = markRaw(new WsClient());
	const connected = ref(false);
	const currentChannelId = ref<string | null>(null);
	/** Set to true after AUTH_OK is received (not just WS open). */
	const authenticated = ref(false);
	/** Set to true when AUTH_FAIL is received — triggers pairing screen. */
	const authFailed = ref(false);
	/** Incremented each time the WS reconnects and re-authenticates successfully. */
	const reconnectCount = ref(0);
	/** Lifecycle unsubscribers — called in disconnect() to clean up. */
	const _unsubs: { disconnect: (() => void) | null; reconnect: (() => void) | null } = {
		disconnect: null,
		reconnect: null,
	};
	/** Guard against multiple concurrent connect() calls from parallel pane mounts. */
	let _connectPromise: Promise<void> | null = null;

	/**
	 * Connect to hub WebSocket, send AUTH, then wait for AUTH_OK or AUTH_FAIL.
	 * On AUTH_OK: stores clientId and resolves.
	 * On AUTH_FAIL: sets authFailed flag and rejects.
	 */
	async function connect(): Promise<void> {
		if (wsClient.isConnected) return;
		if (_connectPromise) return _connectPromise;
		_connectPromise = _doConnect();
		try {
			await _connectPromise;
		} finally {
			_connectPromise = null;
		}
	}

	async function _doConnect(): Promise<void> {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws`;
		await wsClient.connect(wsUrl);
		connected.value = true;

		// Register write-lock message routing before authenticating
		const writeLockStore = useWriteLockStore();
		writeLockStore.setWsClient(wsClient);
		_registerWriteLockHandlers(writeLockStore);

		// Route SESSION_STATE messages to hosts store for rail status dots
		const hostsStore = useHostsStore();
		wsClient.on("SESSION_STATE", (msg) => {
			if (msg.type === "SESSION_STATE") {
				hostsStore.updateSessionStatus(msg.hostId, msg.status);
			}
		});

		// Route CHANNEL_STATE messages to channels store for status dots
		const channelsStore = useChannelsStore();
		wsClient.on("CHANNEL_STATE", (msg) => {
			if (msg.type === "CHANNEL_STATE") {
				channelsStore.updateChannelStatus(msg.channelId, msg.status, msg.exitCode);
			}
		});

		// Handle STATE_SYNC — full state snapshot sent after AUTH_OK
		wsClient.on("STATE_SYNC", (msg) => {
			if (msg.type === "STATE_SYNC") {
				for (const s of msg.sessions) {
					hostsStore.updateSessionStatus(s.hostId, s.status);
				}
				channelsStore.applyStateSync(msg.channels);
			}
		});

		// Authenticate immediately after connecting
		await _authenticate();

		// Track WS disconnection so UI can show reconnecting overlay
		_unsubs.disconnect = wsClient.onDisconnect(() => {
			connected.value = false;
		});

		// Re-authenticate and refresh state after each WS auto-reconnect
		_unsubs.reconnect = wsClient.onReconnect(async () => {
			try {
				connected.value = true;
				await _authenticate();
				// Re-fetch state after reconnect
				const hostsStore2 = useHostsStore();
				await hostsStore2.fetchHosts();
				const channelsStore2 = useChannelsStore();
				if (channelsStore2.activeHostId) {
					await channelsStore2.fetchChannels(channelsStore2.activeHostId);
				}
				// Reload resolved profile (font, cursor, scrollback settings)
				await useConfigStore().loadProfile();
				reconnectCount.value++;
			} catch (err) {
				console.error("[session] Reconnect auth failed:", err);
			}
		});
	}

	/**
	 * Send AUTH and wait for AUTH_OK or AUTH_FAIL.
	 * Resolves on success, rejects on failure.
	 */
	function _authenticate(): Promise<void> {
		const authStore = useAuthStore();

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubOk();
				unsubFail();
				reject(new Error("AUTH timeout — no response after 10s"));
			}, 10_000);

			const unsubOk = wsClient.on("AUTH_OK", (msg) => {
				if (msg.type === "AUTH_OK") {
					clearTimeout(timer);
					unsubOk();
					unsubFail();
					authStore.setClientId(msg.clientId);
					authenticated.value = true;
					authFailed.value = false;
					resolve();
				}
			});

			const unsubFail = wsClient.on("AUTH_FAIL", (msg) => {
				if (msg.type === "AUTH_FAIL") {
					clearTimeout(timer);
					unsubOk();
					unsubFail();
					authenticated.value = false;
					authFailed.value = true;
					reject(new Error(`AUTH_FAIL: ${msg.message}`));
				}
			});

			wsClient.send({
				type: "AUTH",
				token: authStore.token ?? "",
			});
		});
	}

	/**
	 * Wire up write-lock protocol message handlers to the write-lock store.
	 */
	function _registerWriteLockHandlers(writeLockStore: ReturnType<typeof useWriteLockStore>): void {
		wsClient.on("WRITE_LOCK", (msg) => {
			if (msg.type === "WRITE_LOCK") {
				writeLockStore.handleWriteLock(msg.channelId, msg.holder);
			}
		});
		wsClient.on("WRITE_REQUEST", (msg) => {
			if (msg.type === "WRITE_REQUEST") {
				writeLockStore.handleWriteRequest(msg.channelId, msg.fromClientId);
			}
		});
		wsClient.on("WRITE_REVOKED", (msg) => {
			if (msg.type === "WRITE_REVOKED") {
				writeLockStore.handleWriteRevoked(msg.channelId);
			}
		});
		wsClient.on("WRITE_DENY", (msg) => {
			if (msg.type === "WRITE_DENY") {
				writeLockStore.handleWriteDeny(msg.channelId);
			}
		});
	}

	/**
	 * Send SPAWN for the built-in local host.
	 * Returns the channelId once SPAWN_OK is received.
	 */
	function spawnTerminal(): Promise<string> {
		// generateId is used for the request correlation — not strictly required
		// by the hub protocol but useful for future multi-spawn tracking.
		const _requestId = generateId();

		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				unsub();
				reject(new Error("SPAWN timeout — no SPAWN_OK after 10s"));
			}, 10_000);

			const unsub = wsClient.on("SPAWN_OK", (msg) => {
				if (msg.type === "SPAWN_OK") {
					clearTimeout(timer);
					unsub();
					currentChannelId.value = msg.channelId;
					resolve(msg.channelId);
				}
			});

			wsClient.send({
				type: "SPAWN",
				hostId: "local",
			});
		});
	}

	function disconnect(): void {
		_unsubs.disconnect?.();
		_unsubs.disconnect = null;
		_unsubs.reconnect?.();
		_unsubs.reconnect = null;
		wsClient.close();
		connected.value = false;
		authenticated.value = false;
		currentChannelId.value = null;
	}

	return {
		wsClient,
		connected,
		authenticated,
		authFailed,
		currentChannelId,
		reconnectCount,
		connect,
		spawnTerminal,
		disconnect,
	};
});
