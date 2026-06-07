import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { IWsClient } from "../services/ws-client.js";

export interface HostVerifyRequest {
	hostId: string;
	hostname: string;
	fingerprint: string;
	algorithm: string;
	oldFingerprint: string;
	promptId: string;
	/** True on first connection (TOFU) — no previous fingerprint. */
	firstConnect?: boolean;
}

/**
 * Host-verify store — receives HOST_VERIFY (mismatch variant) from the hub,
 * surfaces the HostKeyWarning dialog to the user, and sends back
 * HOST_VERIFY_RESPONSE (trust_permanent, trust_once, or reject).
 *
 * Prompts are queued by promptId so two HOST_VERIFY dialogs from different
 * host contexts routed to the same client do not overwrite each other.
 * PROMPT_CANCEL removes a specific entry by promptId.
 */
export const useHostVerifyStore = defineStore("hostVerify", () => {
	const pendingPrompts = ref<HostVerifyRequest[]>([]);
	let _wsClient: IWsClient | null = null;

	// Current prompt is always the first in the queue
	const currentPrompt = computed(() => pendingPrompts.value[0] ?? null);

	// Legacy alias: components that bind `pendingPrompt` keep working
	const pendingPrompt = currentPrompt;

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
		firstConnect = false,
	): void {
		// Do not enqueue a duplicate promptId
		if (pendingPrompts.value.some((p) => p.promptId === promptId)) return;
		pendingPrompts.value = [
			...pendingPrompts.value,
			{
				hostId,
				hostname,
				fingerprint,
				algorithm,
				oldFingerprint,
				promptId,
				...(firstConnect ? { firstConnect: true } : {}),
			},
		];
	}

	/** Drop the queued prompt whose promptId matches the cancelled one. */
	function handlePromptCancel(promptId: string): void {
		pendingPrompts.value = pendingPrompts.value.filter((p) => p.promptId !== promptId);
	}

	function isCurrentPrompt(promptId: string | undefined, action: string): boolean {
		const req = pendingPrompts.value[0];
		if (!req) return false;
		const currentPromptId = (req as { promptId?: string }).promptId;
		if (promptId === undefined || currentPromptId === undefined || currentPromptId === promptId) {
			return true;
		}
		console.warn("[host-verify] ignoring stale prompt action", {
			action,
			promptId,
			currentPromptId,
		});
		return false;
	}

	function respond(action: "trust_permanent" | "trust_once" | "reject", promptId?: string): void {
		if (!isCurrentPrompt(promptId, action)) return;
		const req = pendingPrompts.value[0];
		if (!req) return;
		_wsClient?.send({
			type: "HOST_VERIFY_RESPONSE",
			hostId: req.hostId,
			action,
			promptId: req.promptId,
		});
		pendingPrompts.value = pendingPrompts.value.slice(1);
	}

	function accept(promptId?: string): void {
		respond("trust_permanent", promptId);
	}

	function trustOnce(promptId?: string): void {
		respond("trust_once", promptId);
	}

	function reject(promptId?: string): void {
		respond("reject", promptId);
	}

	function dismiss(promptId?: string): void {
		respond("reject", promptId);
	}

	return {
		pendingPrompt,
		currentPrompt,
		setWsClient,
		handleHostVerify,
		handlePromptCancel,
		respond,
		accept,
		trustOnce,
		reject,
		dismiss,
	};
});
