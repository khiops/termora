import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IWsClient } from "../services/ws-client.js";
import { useAuthPromptStore } from "./auth-prompt.js";

function makeMockWsClient(): IWsClient {
	return {
		send: vi.fn(),
		on: vi.fn(),
		isConnected: true,
		connect: vi.fn(),
		close: vi.fn(),
		onDisconnect: vi.fn(),
		onReconnect: vi.fn(),
	} as unknown as IWsClient;
}

describe("useAuthPromptStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("handleAuthPrompt sets pendingPrompt", () => {
		const store = useAuthPromptStore();
		expect(store.pendingPrompt).toBeNull();

		store.handleAuthPrompt("host-1", "password", "Enter SSH password");
		expect(store.pendingPrompt).toEqual({
			hostId: "host-1",
			promptType: "password",
			message: "Enter SSH password",
		});
	});

	it("handleAuthPrompt sets pendingPrompt for passphrase type", () => {
		const store = useAuthPromptStore();
		store.handleAuthPrompt("host-2", "passphrase", "Enter key passphrase");
		expect(store.pendingPrompt).toEqual({
			hostId: "host-2",
			promptType: "passphrase",
			message: "Enter key passphrase",
		});
	});

	it("respond(secret) sends AUTH_PROMPT_RESPONSE via wsClient and clears pendingPrompt", () => {
		const store = useAuthPromptStore();
		const wsClient = makeMockWsClient();
		store.setWsClient(wsClient);
		store.handleAuthPrompt("host-1", "password", "Enter SSH password");

		store.respond("mysecret");

		expect(wsClient.send).toHaveBeenCalledWith({
			type: "AUTH_PROMPT_RESPONSE",
			hostId: "host-1",
			secret: "mysecret",
			rememberSession: false,
		});
		expect(store.pendingPrompt).toBeNull();
	});

	it("respond(secret) sends rememberSession=true when opted in", () => {
		const store = useAuthPromptStore();
		const wsClient = makeMockWsClient();
		store.setWsClient(wsClient);
		store.handleAuthPrompt("host-1", "passphrase", "Enter passphrase");
		store.rememberSession = true;

		store.respond("my-passphrase");

		expect(wsClient.send).toHaveBeenCalledWith({
			type: "AUTH_PROMPT_RESPONSE",
			hostId: "host-1",
			secret: "my-passphrase",
			rememberSession: true,
		});
		expect(store.pendingPrompt).toBeNull();
		// rememberSession is reset after respond
		expect(store.rememberSession).toBe(false);
	});

	it("dismiss() sends AUTH_PROMPT_RESPONSE with secret=null", () => {
		const store = useAuthPromptStore();
		const wsClient = makeMockWsClient();
		store.setWsClient(wsClient);
		store.handleAuthPrompt("host-1", "password", "Enter SSH password");

		store.dismiss();

		expect(wsClient.send).toHaveBeenCalledWith({
			type: "AUTH_PROMPT_RESPONSE",
			hostId: "host-1",
			secret: null,
			rememberSession: false,
		});
		expect(store.pendingPrompt).toBeNull();
	});

	it("respond when no pending prompt is a no-op", () => {
		const store = useAuthPromptStore();
		const wsClient = makeMockWsClient();
		store.setWsClient(wsClient);

		// No prompt set — should not throw and should not send anything
		store.respond("secret");

		expect(wsClient.send).not.toHaveBeenCalled();
		expect(store.pendingPrompt).toBeNull();
	});

	it("respond without wsClient set does not throw", () => {
		const store = useAuthPromptStore();
		store.handleAuthPrompt("host-1", "password", "Enter SSH password");

		// wsClient not set — should not throw
		expect(() => store.respond("secret")).not.toThrow();
		expect(store.pendingPrompt).toBeNull();
	});
});
