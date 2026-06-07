import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { IWsClient } from "../services/ws-client.js";

export interface AuthPromptRequest {
	hostId: string;
	promptType: "password" | "passphrase" | "elevation";
	message: string;
	/** Per-prompt passphrase cache opt-in. Missing means false for back-compat. */
	rememberSession?: boolean;
	/** Correlation ID — echoed back in AUTH_PROMPT_RESPONSE. */
	promptId?: string;
	/** Delivery epoch from hub — echoed back for stale-response guard. */
	deliveryEpoch?: number;
}

/**
 * Auth-prompt store — receives AUTH_PROMPT from hub when SSH needs a
 * password or key passphrase, surfaces it to the UI, and sends back
 * AUTH_PROMPT_RESPONSE (secret or null for cancel).
 *
 * Prompts are queued by promptId so two concurrent prompts routed to
 * the same client do not overwrite each other. The first entry in the
 * queue is the one currently shown; responding pops it and surfaces the
 * next (if any). PROMPT_CANCEL removes a specific entry by promptId.
 */
export const useAuthPromptStore = defineStore("authPrompt", () => {
	const pendingPrompts = ref<AuthPromptRequest[]>([]);
	let _wsClient: IWsClient | null = null;

	// Current prompt is always the first in the queue
	const currentPrompt = computed(() => pendingPrompts.value[0] ?? null);

	const rememberSession = computed({
		get: () => currentPrompt.value?.rememberSession ?? false,
		set: (value: boolean) => {
			if (currentPrompt.value) {
				currentPrompt.value.rememberSession = value;
			}
		},
	});

	// Legacy alias: components that bind `pendingPrompt` keep working
	const pendingPrompt = currentPrompt;

	function setWsClient(client: IWsClient): void {
		_wsClient = client;
	}

	function handleAuthPrompt(
		hostId: string,
		promptType: "password" | "passphrase" | "elevation",
		message: string,
		promptId?: string,
		deliveryEpoch?: number,
	): void {
		// Key for dedup/cancel: use promptId when present, fall back to hostId
		const key = promptId ?? hostId;
		// Do not enqueue a duplicate that is already in the queue
		if (pendingPrompts.value.some((p) => (p.promptId ?? p.hostId) === key)) return;
		pendingPrompts.value = [
			...pendingPrompts.value,
			{
				hostId,
				promptType,
				message,
				rememberSession: false,
				...(promptId !== undefined ? { promptId } : {}),
				...(deliveryEpoch !== undefined ? { deliveryEpoch } : {}),
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
		if (promptId === undefined || req.promptId === undefined || req.promptId === promptId) {
			return true;
		}
		console.warn("[auth-prompt] ignoring stale prompt action", {
			action,
			promptId,
			currentPromptId: req.promptId,
		});
		return false;
	}

	function respond(secret: string | null, promptId?: string): void {
		if (!isCurrentPrompt(promptId, secret === null ? "dismiss" : "respond")) return;
		const req = pendingPrompts.value[0];
		if (!req) return;
		_wsClient?.send({
			type: "AUTH_PROMPT_RESPONSE",
			hostId: req.hostId,
			secret,
			rememberSession: req.rememberSession ?? false,
			...(req.promptId !== undefined ? { promptId: req.promptId } : {}),
			...(req.deliveryEpoch !== undefined ? { deliveryEpoch: req.deliveryEpoch } : {}),
		});
		// Remove the first item from the queue — next one shows automatically
		pendingPrompts.value = pendingPrompts.value.slice(1);
	}

	function dismiss(promptId?: string): void {
		respond(null, promptId);
	}

	return {
		pendingPrompt,
		currentPrompt,
		rememberSession,
		setWsClient,
		handleAuthPrompt,
		handlePromptCancel,
		respond,
		dismiss,
	};
});
