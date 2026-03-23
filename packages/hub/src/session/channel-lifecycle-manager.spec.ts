import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelLifecycleManager } from "./channel-lifecycle-manager.js";
import type { SharedSessionContext } from "./session-context.js";

// ─── Minimal context stub ─────────────────────────────────────────────────────
// ChannelLifecycleManager only touches ctx.pendingAuthPrompts in _buildPromptAuth
// and cancelPendingAuthPromptsForClient. We provide just that slice.

function makeMinimalCtx(): Pick<SharedSessionContext, "pendingAuthPrompts"> {
	return {
		pendingAuthPrompts: new Map(),
	};
}

// Minimal WsClient stub
function makeWsClient(id: string, onSend?: (msg: unknown) => void) {
	return {
		id,
		send: (msg: unknown) => onSend?.(msg),
		attachedChannels: new Set<string>(),
	};
}

// ─── SEC-015 Tests ────────────────────────────────────────────────────────────

describe("ChannelLifecycleManager — SEC-015 pending auth prompt security", () => {
	let ctx: Pick<SharedSessionContext, "pendingAuthPrompts">;
	let lifecycle: ChannelLifecycleManager;

	// Minimal broadcaster stub — only used by constructor, not by auth-prompt methods
	const broadcaster = {} as import("./state-broadcaster.js").StateBroadcaster;

	beforeEach(() => {
		ctx = makeMinimalCtx();
		// Cast ctx: ChannelLifecycleManager only uses pendingAuthPrompts for these tests
		lifecycle = new ChannelLifecycleManager(
			ctx as unknown as SharedSessionContext,
			broadcaster,
		);
	});

	afterEach(() => {
		// Clean up any pending timers
		for (const [, pending] of ctx.pendingAuthPrompts.entries()) {
			if (pending.timer !== null) clearTimeout(pending.timer);
		}
		ctx.pendingAuthPrompts.clear();
	});

	it("SEC-015-A: _buildPromptAuth registers a non-null timer in pendingAuthPrompts", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const hostId = "host-001";
			const sentMessages: unknown[] = [];
			const client = makeWsClient("c-a", (m) => sentMessages.push(m));

			// Access _buildPromptAuth via cast (private method under test)
			const buildPromptAuth = (
				lifecycle as unknown as {
					_buildPromptAuth: (client: typeof client) => (
						hostId: string,
						promptType: string,
						message: string,
					) => Promise<string | null>;
				}
			)._buildPromptAuth.bind(lifecycle);

			const promptFn = buildPromptAuth(client as never);

			// Invoke the prompt function (does NOT await — we want to inspect mid-flight)
			const promptPromise = promptFn(hostId, "password", "Enter password");

			// AUTH_PROMPT should have been sent to client
			expect(sentMessages).toHaveLength(1);
			expect((sentMessages[0] as Record<string, unknown>).type).toBe("AUTH_PROMPT");

			// Pending entry should exist with a non-null timer
			const pending = ctx.pendingAuthPrompts.get(hostId);
			expect(pending).toBeDefined();
			expect(pending!.timer).not.toBeNull();
			expect(pending!.clientId).toBe("c-a");

			// Advance fake timers by 60s — timeout should resolve the promise with null
			vi.advanceTimersByTime(60_000);

			const result = await promptPromise;
			expect(result).toBeNull();

			// Pending entry is cleaned up by the timer
			expect(ctx.pendingAuthPrompts.has(hostId)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("SEC-015-B: _buildPromptAuth cancels an existing pending prompt for the same hostId (race guard)", async () => {
		const hostId = "host-002";
		const sentMessages: unknown[] = [];
		const client = makeWsClient("c-b", (m) => sentMessages.push(m));

		const buildPromptAuth = (
			lifecycle as unknown as {
				_buildPromptAuth: (client: typeof client) => (
					hostId: string,
					promptType: string,
					message: string,
				) => Promise<string | null>;
			}
		)._buildPromptAuth.bind(lifecycle);

		const promptFn = buildPromptAuth(client as never);

		// First call: installs a pending entry
		const firstPromise = promptFn(hostId, "password", "First prompt");

		const firstPending = ctx.pendingAuthPrompts.get(hostId);
		expect(firstPending).toBeDefined();

		let firstResolved: string | null = "NOT_SET";
		void firstPromise.then((v) => { firstResolved = v; });

		// Second call for same hostId: should cancel first
		const secondPromise = promptFn(hostId, "elevation", "Second prompt");

		// First promise resolves with null (cancelled by race guard)
		// Need multiple microtask flushes: inner promise resolves → outer async promise chains → .then() fires
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(firstResolved).toBeNull();

		// Second pending entry is now registered
		const secondPending = ctx.pendingAuthPrompts.get(hostId);
		expect(secondPending).toBeDefined();
		expect(secondPending).not.toBe(firstPending);

		// Clean up second promise
		const sp = ctx.pendingAuthPrompts.get(hostId);
		if (sp) {
			if (sp.timer !== null) clearTimeout(sp.timer);
			sp.resolve(null);
			ctx.pendingAuthPrompts.delete(hostId);
		}
		await secondPromise;
	});

	it("SEC-015-C: cancelPendingAuthPromptsForClient resolves prompts only for the given clientId", async () => {
		const hostId1 = "host-003";
		const hostId2 = "host-004";
		const clientA = "c-c-a";
		const clientB = "c-c-b";

		let resolvedA: string | null = "NOT_SET";
		let resolvedB: string | null = "NOT_SET";

		const timerA = setTimeout(() => { /* no-op */ }, 60_000);
		const timerB = setTimeout(() => { /* no-op */ }, 60_000);

		ctx.pendingAuthPrompts.set(hostId1, {
			resolve: (s) => { resolvedA = s; },
			timer: timerA,
			clientId: clientA,
		});
		ctx.pendingAuthPrompts.set(hostId2, {
			resolve: (s) => { resolvedB = s; },
			timer: timerB,
			clientId: clientB,
		});

		// Disconnect clientA
		lifecycle.cancelPendingAuthPromptsForClient(clientA);

		// clientA's prompt is cancelled
		expect(resolvedA).toBeNull();
		expect(ctx.pendingAuthPrompts.has(hostId1)).toBe(false);

		// clientB's prompt is untouched
		expect(resolvedB).toBe("NOT_SET");
		expect(ctx.pendingAuthPrompts.has(hostId2)).toBe(true);

		// Clean up clientB
		clearTimeout(timerB);
		ctx.pendingAuthPrompts.delete(hostId2);
	});

	it("SEC-015-D: timer is cleared (not leaked) when prompt is resolved normally", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const hostId = "host-005";
			const sentMessages: unknown[] = [];
			const client = makeWsClient("c-d", (m) => sentMessages.push(m));

			const buildPromptAuth = (
				lifecycle as unknown as {
					_buildPromptAuth: (client: typeof client) => (
						hostId: string,
						promptType: string,
						message: string,
					) => Promise<string | null>;
				}
			)._buildPromptAuth.bind(lifecycle);

			const promptFn = buildPromptAuth(client as never);
			const promptPromise = promptFn(hostId, "password", "Enter password");

			// Simulate normal resolution: handleAuthPromptResponse clears timer + deletes entry
			const pending = ctx.pendingAuthPrompts.get(hostId);
			expect(pending).toBeDefined();
			expect(pending!.timer).not.toBeNull();

			const timersBefore = vi.getTimerCount();

			// Resolve normally (as handleAuthPromptResponse does)
			if (pending!.timer !== null) clearTimeout(pending!.timer);
			ctx.pendingAuthPrompts.delete(hostId);
			pending!.resolve("correct-secret");

			const timersAfter = vi.getTimerCount();

			// Timer count should have decreased (timer was cleared)
			expect(timersAfter).toBeLessThan(timersBefore);

			const result = await promptPromise;
			expect(result).toBe("correct-secret");

			// After the 60s would have elapsed, nothing bad happens
			vi.advanceTimersByTime(60_000);
			// pendingAuthPrompts is already empty — no double-resolve
			expect(ctx.pendingAuthPrompts.has(hostId)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
