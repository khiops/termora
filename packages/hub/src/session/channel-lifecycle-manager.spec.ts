import type { AgentSpawnOkMessage, ChannelCreatedMessage, ProtocolMessage } from "@termora/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelLifecycleManager } from "./channel-lifecycle-manager.js";
import type { SharedSessionContext } from "./session-context.js";
import { StateBroadcaster } from "./state-broadcaster.js";

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
		lifecycle = new ChannelLifecycleManager(ctx as unknown as SharedSessionContext, broadcaster);
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
					_buildPromptAuth: (
						client: typeof client,
					) => (hostId: string, promptType: string, message: string) => Promise<string | null>;
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
				_buildPromptAuth: (
					client: typeof client,
				) => (hostId: string, promptType: string, message: string) => Promise<string | null>;
			}
		)._buildPromptAuth.bind(lifecycle);

		const promptFn = buildPromptAuth(client as never);

		// First call: installs a pending entry
		const firstPromise = promptFn(hostId, "password", "First prompt");

		const firstPending = ctx.pendingAuthPrompts.get(hostId);
		expect(firstPending).toBeDefined();

		let firstResolved: string | null = "NOT_SET";
		void firstPromise.then((v) => {
			firstResolved = v;
		});

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

		const timerA = setTimeout(() => {
			/* no-op */
		}, 60_000);
		const timerB = setTimeout(() => {
			/* no-op */
		}, 60_000);

		ctx.pendingAuthPrompts.set(hostId1, {
			resolve: (s) => {
				resolvedA = s;
			},
			timer: timerA,
			clientId: clientA,
		});
		ctx.pendingAuthPrompts.set(hostId2, {
			resolve: (s) => {
				resolvedB = s;
			},
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
					_buildPromptAuth: (
						client: typeof client,
					) => (hostId: string, promptType: string, message: string) => Promise<string | null>;
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

// ─── CHANNEL_CREATED broadcast tests ─────────────────────────────────────────

/**
 * Build a minimal SharedSessionContext that has just enough surface area for
 * sendSpawnAndWait: pendingRequests, channels, clients, metaDal, scheduler,
 * chunker, and hubLogger.
 */
function makeSpawnCtx(overrides?: {
	getChannel?: () => import("@termora/shared").Channel | undefined;
}) {
	const clients = new Map<string, ReturnType<typeof makeWsClient>>();
	const channels = new Map<
		string,
		{
			sessionId: string;
			hostId: string;
			status: string;
			clients: Set<string>;
			shell: string;
			cols: number;
			rows: number;
			dynamicTitle: null;
			processTitle: null;
			displayTitle: string;
		}
	>();
	const pendingRequests = new Map<string, (msg: ProtocolMessage) => void>();

	const now = new Date().toISOString();
	const metaDal = {
		createChannel: vi.fn(),
		updateChannelStatus: vi.fn(),
		getChannel:
			overrides?.getChannel ??
			vi.fn().mockReturnValue({
				id: "ch-1",
				sessionId: "sess-1",
				shell: "/bin/bash",
				cols: 80,
				rows: 24,
				status: "live" as const,
				createdAt: now,
				updatedAt: now,
			}),
	};

	const scheduler = { trackChannel: vi.fn() };
	const chunker = { trackChannel: vi.fn() };

	return {
		clients,
		channels,
		pendingRequests,
		metaDal,
		scheduler,
		chunker,
		sessions: new Map(),
		agents: new Map(),
		pendingAuthPrompts: new Map(),
		hubLogger: null,
		now,
	};
}

describe("ChannelLifecycleManager — CHANNEL_CREATED broadcast (multi-client sync)", () => {
	it("broadcasts CHANNEL_CREATED to all attached clients including an observer", async () => {
		// ── Arrange ──────────────────────────────────────────────────────────
		const spawnerMessages: ProtocolMessage[] = [];
		const observerMessages: ProtocolMessage[] = [];

		const spawner = makeWsClient("spawner", (m) => spawnerMessages.push(m as ProtocolMessage));
		const observer = makeWsClient("observer", (m) => observerMessages.push(m as ProtocolMessage));

		const { clients, channels, pendingRequests, metaDal, scheduler, chunker, now } = makeSpawnCtx();

		// Both clients are registered (e.g. both browsing the same hub)
		clients.set(spawner.id, spawner as never);
		clients.set(observer.id, observer as never);

		const ctx = {
			clients,
			channels,
			pendingRequests,
			metaDal,
			scheduler,
			chunker,
			sessions: new Map(),
			agents: new Map(),
			pendingAuthPrompts: new Map(),
			hubLogger: null,
			primaryToken: null,
		} as unknown as SharedSessionContext;

		const broadcaster = new StateBroadcaster(ctx);
		const manager = new ChannelLifecycleManager(ctx, broadcaster);

		const mockAgent = {
			connected: true,
			send: vi.fn(),
		};

		const spawnMsg = {
			type: "SPAWN" as const,
			requestId: "req-1",
			channelId: "ch-1",
			cols: 80,
			rows: 24,
		} as import("@termora/shared").AgentSpawnMessage;

		const session = { id: "sess-1" };
		const hostId = "host-1";

		// ── Act ───────────────────────────────────────────────────────────────
		// Start the spawn; it will hang waiting for SPAWN_OK — resolve it after
		const spawnPromise = manager.sendSpawnAndWait({
			agent: mockAgent as never,
			spawnMsg,
			clientId: spawner.id,
			hostId,
			session,
			client: spawner as never,
			resolvedShell: "/bin/bash",
			resolvedArgs: [],
			resolvedCwd: undefined,
			resolvedDirectProcess: false,
			resolvedLaunchProfileId: undefined,
			cols: 80,
			rows: 24,
		});

		// Simulate the agent responding with SPAWN_OK
		const spawnOk: AgentSpawnOkMessage = {
			type: "SPAWN_OK",
			requestId: "req-1",
			channelId: "ch-1",
		};
		const handler = pendingRequests.get("req-1");
		expect(handler).toBeDefined();
		handler!(spawnOk);

		const result = await spawnPromise;

		// ── Assert ────────────────────────────────────────────────────────────
		expect(result.channelId).toBe("ch-1");
		expect(result.errCode).toBeNull();

		// Observer must have received a CHANNEL_CREATED message
		const createdMsgs = observerMessages.filter((m) => m.type === "CHANNEL_CREATED");
		expect(createdMsgs).toHaveLength(1);

		const created = createdMsgs[0] as ChannelCreatedMessage;
		expect(created.channelId).toBe("ch-1");
		expect(created.hostId).toBe(hostId);
		expect(created.sessionId).toBe(session.id);
		expect(created.status).toBe("live");
		expect(created.shell).toBe("/bin/bash");
		expect(created.cols).toBe(80);
		expect(created.rows).toBe(24);
		expect(created.createdAt).toBe(now);

		// Spawner also receives CHANNEL_CREATED (it deduplicates on the web side)
		const spawnerCreated = spawnerMessages.filter((m) => m.type === "CHANNEL_CREATED");
		expect(spawnerCreated).toHaveLength(1);

		// Spawner also received SPAWN_OK (its primary response)
		const spawnerOk = spawnerMessages.filter((m) => m.type === "SPAWN_OK");
		expect(spawnerOk).toHaveLength(1);
	});

	it("does not broadcast CHANNEL_CREATED when spawn fails with SPAWN_ERR", async () => {
		// ── Arrange ──────────────────────────────────────────────────────────
		const observerMessages: ProtocolMessage[] = [];
		const spawnerMessages: ProtocolMessage[] = [];

		const spawner = makeWsClient("spawner-2", (m) => spawnerMessages.push(m as ProtocolMessage));
		const observer = makeWsClient("observer-2", (m) => observerMessages.push(m as ProtocolMessage));

		const { clients, channels, pendingRequests, metaDal, scheduler, chunker } = makeSpawnCtx();
		clients.set(spawner.id, spawner as never);
		clients.set(observer.id, observer as never);

		const ctx = {
			clients,
			channels,
			pendingRequests,
			metaDal,
			scheduler,
			chunker,
			sessions: new Map(),
			agents: new Map(),
			pendingAuthPrompts: new Map(),
			hubLogger: null,
			primaryToken: null,
		} as unknown as SharedSessionContext;

		const broadcaster = new StateBroadcaster(ctx);
		const manager = new ChannelLifecycleManager(ctx, broadcaster);

		const spawnMsg = {
			type: "SPAWN" as const,
			requestId: "req-err",
			channelId: "ch-err",
			cols: 80,
			rows: 24,
		} as import("@termora/shared").AgentSpawnMessage;

		const spawnPromise = manager.sendSpawnAndWait({
			agent: { connected: true, send: vi.fn() } as never,
			spawnMsg,
			clientId: spawner.id,
			hostId: "host-1",
			session: { id: "sess-1" },
			client: spawner as never,
			resolvedShell: "/bin/bash",
			resolvedArgs: [],
			resolvedCwd: undefined,
			resolvedDirectProcess: false,
			resolvedLaunchProfileId: undefined,
			cols: 80,
			rows: 24,
		});

		// Agent responds with SPAWN_ERR
		const handler = pendingRequests.get("req-err");
		handler!({
			type: "SPAWN_ERR",
			requestId: "req-err",
			code: "SHELL_NOT_FOUND",
			message: "shell not found",
		} as import("@termora/shared").AgentSpawnErrMessage);

		await spawnPromise;

		// ── Assert ────────────────────────────────────────────────────────────
		// Observer must NOT receive CHANNEL_CREATED on failure
		const createdMsgs = observerMessages.filter((m) => m.type === "CHANNEL_CREATED");
		expect(createdMsgs).toHaveLength(0);
	});
});
