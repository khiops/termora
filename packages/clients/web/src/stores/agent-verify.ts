import type { AgentBinaryVerifyMessage } from "@termora/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
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
		// Do not enqueue a duplicate promptId
		if (pendingPrompts.value.some((p) => p.promptId === msg.promptId)) return;
		pendingPrompts.value = [...pendingPrompts.value, { ...msg }];
	}

	/** Drop the queued prompt whose promptId matches the cancelled one. */
	function handlePromptCancel(promptId: string): void {
		pendingPrompts.value = pendingPrompts.value.filter((p) => p.promptId !== promptId);
	}

	function handleDeployError(message: string, hostId?: string): void {
		deployError.value = { message, ...(hostId !== undefined ? { hostId } : {}) };
	}

	function clearDeployError(): void {
		deployError.value = null;
	}

	function isCurrentPrompt(promptId: string | undefined, action: string): boolean {
		const req = pendingPrompts.value[0];
		if (!req) return false;
		const currentPromptId = (req as { promptId?: string }).promptId;
		if (promptId === undefined || currentPromptId === undefined || currentPromptId === promptId) {
			return true;
		}
		console.warn("[agent-verify] ignoring stale prompt action", {
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
			type: "AGENT_BINARY_VERIFY_RESPONSE",
			promptId: req.promptId,
			action,
		});
		// Remove the first item from the queue — next one shows automatically
		pendingPrompts.value = pendingPrompts.value.slice(1);
	}

	function trustPermanently(promptId?: string): void {
		respond("trust_permanent", promptId);
	}

	function trustOnce(promptId?: string): void {
		respond("trust_once", promptId);
	}

	function reject(promptId?: string): void {
		respond("reject", promptId);
	}

	function dismiss(promptId?: string): void {
		if (!isCurrentPrompt(promptId, "dismiss")) return;
		pendingPrompts.value = pendingPrompts.value.slice(1);
	}

	return {
		currentPrompt,
		deployError,
		setWsClient,
		handleAgentVerify,
		handlePromptCancel,
		handleDeployError,
		clearDeployError,
		respond,
		trustPermanently,
		trustOnce,
		reject,
		dismiss,
	};
});
