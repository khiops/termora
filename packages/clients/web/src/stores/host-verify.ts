import { defineStore } from "pinia";
import { ref } from "vue";
import type { IWsClient } from "../services/ws-client.js";

export interface HostVerifyRequest {
	hostId: string;
	hostname: string;
	fingerprint: string;
	algorithm: string;
	oldFingerprint: string;
	promptId: string;
}

/**
 * Host-verify store — receives HOST_VERIFY (mismatch variant) from the hub,
 * surfaces the HostKeyWarning dialog to the user, and sends back
 * HOST_VERIFY_RESPONSE (trust_permanent, trust_once, or reject).
 */
export const useHostVerifyStore = defineStore("hostVerify", () => {
	const pendingPrompt = ref<HostVerifyRequest | null>(null);
	let _wsClient: IWsClient | null = null;

	function setWsClient(client: IWsClient): void {
		_wsClient = client;
	}

	function handleHostVerify(
		hostId: string,
		hostname: string,
		fingerprint: string,
		algorithm: string,
		oldFingerprint: string,
		promptId: string,
	): void {
		pendingPrompt.value = { hostId, hostname, fingerprint, algorithm, oldFingerprint, promptId };
	}

	function respond(action: "trust_permanent" | "trust_once" | "reject"): void {
		const req = pendingPrompt.value;
		if (!req) return;
		_wsClient?.send({
			type: "HOST_VERIFY_RESPONSE",
			hostId: req.hostId,
			action,
			promptId: req.promptId,
		});
		pendingPrompt.value = null;
	}

	function accept(): void {
		respond("trust_permanent");
	}

	function reject(): void {
		respond("reject");
	}

	function dismiss(): void {
		respond("reject");
	}

	return {
		pendingPrompt,
		setWsClient,
		handleHostVerify,
		respond,
		accept,
		reject,
		dismiss,
	};
});
