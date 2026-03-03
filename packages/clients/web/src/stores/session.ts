import { generateId } from "@nexterm/shared";
import { defineStore } from "pinia";
import { markRaw, ref } from "vue";
import { WsClient } from "../services/ws-client.js";

export const useSessionStore = defineStore("session", () => {
	// markRaw: prevent Pinia/Vue from making WsClient reactive,
	// which would strip private class members and break the class methods.
	const wsClient = markRaw(new WsClient());
	const connected = ref(false);
	const currentChannelId = ref<string | null>(null);

	async function connect(): Promise<void> {
		if (wsClient.isConnected) return;
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws`;
		await wsClient.connect(wsUrl);
		connected.value = true;
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
		wsClient.close();
		connected.value = false;
		currentChannelId.value = null;
	}

	return {
		wsClient,
		connected,
		currentChannelId,
		connect,
		spawnTerminal,
		disconnect,
	};
});
