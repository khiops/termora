import { defineStore } from "pinia";
import { ref } from "vue";
import type { IWsClient } from "../services/ws-client.js";

export interface AuthPromptRequest {
	hostId: string;
	promptType: "password" | "passphrase" | "elevation";
	message: string;
}

/**
 * Auth-prompt store — receives AUTH_PROMPT from hub when SSH needs a
 * password or key passphrase, surfaces it to the UI, and sends back
 * AUTH_PROMPT_RESPONSE (secret or null for cancel).
 */
export const useAuthPromptStore = defineStore("authPrompt", () => {
	const pendingPrompt = ref<AuthPromptRequest | null>(null);
	const rememberSession = ref(false);
	let _wsClient: IWsClient | null = null;

	function setWsClient(client: IWsClient): void {
		_wsClient = client;
	}

	function handleAuthPrompt(
		hostId: string,
		promptType: "password" | "passphrase" | "elevation",
		message: string,
	): void {
		pendingPrompt.value = { hostId, promptType, message };
	}

	function respond(secret: string | null): void {
		const req = pendingPrompt.value;
		if (!req) return;
		_wsClient?.send({
			type: "AUTH_PROMPT_RESPONSE",
			hostId: req.hostId,
			secret,
			rememberSession: rememberSession.value,
		});
		pendingPrompt.value = null;
		rememberSession.value = false;
	}

	function dismiss(): void {
		respond(null);
	}

	return {
		pendingPrompt,
		rememberSession,
		setWsClient,
		handleAuthPrompt,
		respond,
		dismiss,
	};
});
