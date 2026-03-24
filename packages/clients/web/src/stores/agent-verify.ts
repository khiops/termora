
import { defineStore } from "pinia";
import { ref } from "vue";
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
	const pendingPrompt = ref<AgentVerifyRequest | null>(null);
	const deployError = ref<{ message: string } | null>(null);
	let _wsClient: IWsClient | null = null;

	function setWsClient(client: IWsClient): void {
		_wsClient = client;
	}

	function handleAgentVerify(msg: AgentBinaryVerifyMessage): void {
		pendingPrompt.value = { ...msg };
	}

	function handleDeployError(message: string): void {
		deployError.value = { message };
	}

	function clearDeployError(): void {
		deployError.value = null;
	}

	function respond(action: "trust_permanent" | "trust_once" | "reject"): void {
		const req = pendingPrompt.value;
		if (!req) return;
		_wsClient?.send({
			type: "AGENT_BINARY_VERIFY_RESPONSE",
			promptId: req.promptId,
			action,
		});
		pendingPrompt.value = null;
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
		pendingPrompt.value = null;
	}

	return {
		pendingPrompt,
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