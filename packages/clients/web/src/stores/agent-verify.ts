
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AgentBinaryVerifyMessage } from "@nexterm/shared";
import type { IWsClient } from "../services/ws-client.js";

/**
 * Agent-verify store — receives AGENT_BINARY_VERIFY from the hub,
 * surfaces the AgentBinaryVerify dialog to the user, and sends back
 * AGENT_BINARY_VERIFY_RESPONSE (trust_permanent, trust_once, or reject).
 * Also surfaces AGENT_NOT_AVAILABLE / AGENT_UPDATED error codes.
 */

export interface AgentVerifyRequest extends AgentBinaryVerifyMessage {}

export const useAgentVerifyStore = defineStore("agentVerify", () => {
	const pendingPrompts = ref<AgentVerifyRequest[]>([]);
	const deployError = ref<{ message: string; hostId?: string } | null>(null);
	let _wsClient: IWsClient | null = null;

	// Current prompt is always the first in the queue
	const currentPrompt = computed(() => pendingPrompts.value[0] ?? null);

	function setWsClient(client: IWsClient): void {
		_wsClient = client;
	}

	function handleAgentVerify(msg: AgentBinaryVerifyMessage): void {
		pendingPrompts.value = [...pendingPrompts.value, { ...msg }];
	}

	function handleDeployError(message: string, hostId?: string): void {
		deployError.value = { message, ...(hostId !== undefined ? { hostId } : {}) };
	}

	function clearDeployError(): void {
		deployError.value = null;
	}

	function respond(action: "trust_permanent" | "trust_once" | "reject"): void {
		const req = pendingPrompts.value[0];
		if (!req) return;
		_wsClient?.send({
			type: "AGENT_BINARY_VERIFY_RESPONSE",
			promptId: req.promptId,
			action,
		});
		// Remove the first item from the queue — next one shows automatically
		pendingPrompts.value = pendingPrompts.value.slice(1);
	}

	function trustPermanently(): void {
		respond("trust_permanent");
	}

	function trustOnce(): void {
		respond("trust_once");
	}

	function reject(): void {
		respond("reject");
	}

	function dismiss(): void {
		pendingPrompts.value = pendingPrompts.value.slice(1);
	}

	return {
		currentPrompt,
		deployError,
		setWsClient,
		handleAgentVerify,
		handleDeployError,
		clearDeployError,
		respond,
		trustPermanently,
		trustOnce,
		reject,
		dismiss,
	};
});