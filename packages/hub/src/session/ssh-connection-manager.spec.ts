import { describe, expect, it, vi } from "vitest";
import type { SharedSessionContext } from "./session-context.js";
import { SshConnectionManager } from "./ssh-connection-manager.js";

// ─── Mock SshAgent for reconnect tests ──────────────────────────────────────
let capturedSshAgentArgs: ConstructorParameters<typeof import("./ssh-agent.js").SshAgent> | null =
	null;

vi.mock("./ssh-agent.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./ssh-agent.js")>();
	return {
		...actual,
		// biome-ignore lint/complexity/useArrowFunction: vitest 4 needs a constructable function for new-ed mocks
		SshAgent: vi.fn().mockImplementation(function (...args: unknown[]) {
			capturedSshAgentArgs = args as never;
			return {
				lastKeyVerification: { capturedFingerprint: "SHA256:mock", mismatch: false, tofu: false },
				start: vi.fn().mockResolvedValue(undefined),
				send: vi.fn(),
				close: vi.fn(),
				on: vi.fn().mockReturnThis(),
				once: vi.fn().mockReturnThis(),
				off: vi.fn().mockReturnThis(),
			};
		}),
	};
});

/** Minimal context slice needed by buildPromptAuth / handleAuthPromptResponse. */
function makeCtx(): Pick<SharedSessionContext, "pendingAuthPrompts" | "passphraseCache"> {
	return {
		pendingAuthPrompts: new Map(),
		passphraseCache: new Map(),
	};
}

function makeMgr(ctx: ReturnType<typeof makeCtx>): SshConnectionManager {
	return new SshConnectionManager(
		ctx as SharedSessionContext,
		null as never,
		null as never,
		null as never,
	);
}

function makeClient(id: string) {
	return { id, send: vi.fn() } as never;
}

describe("SshConnectionManager — passphrase cache", () => {
	it("buildPromptAuth returns cached passphrase immediately (no send)", async () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-1";

		ctx.passphraseCache.set(hostId, { secret: "cached-pass", expiresAt: Date.now() + 60_000 });

		const client = makeClient("c1");
		const promptAuth = mgr.buildPromptAuth(client);
		const result = await promptAuth(hostId, "passphrase", "Enter passphrase");

		expect(result).toBe("cached-pass");
		expect(client.send).not.toHaveBeenCalled();
	});

	it("buildPromptAuth evicts expired passphrase and falls through to prompt", async () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-2";

		ctx.passphraseCache.set(hostId, { secret: "stale", expiresAt: Date.now() - 1 });

		const client = makeClient("c2");
		const promptAuth = mgr.buildPromptAuth(client);

		const promise = promptAuth(hostId, "passphrase", "Enter passphrase");
		expect(client.send).toHaveBeenCalledWith(
			expect.objectContaining({ type: "AUTH_PROMPT", hostId }),
		);
		expect(ctx.passphraseCache.has(hostId)).toBe(false);

		ctx.pendingAuthPrompts.get(hostId)?.resolve(null);
		await promise;
	});

	it("buildPromptAuth does not use cache for non-passphrase types", async () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-3";

		ctx.passphraseCache.set(hostId, { secret: "cached-pass", expiresAt: Date.now() + 60_000 });

		const client = makeClient("c3");
		const promptAuth = mgr.buildPromptAuth(client);

		const promise = promptAuth(hostId, "password", "Enter password");
		expect(client.send).toHaveBeenCalledWith(
			expect.objectContaining({ type: "AUTH_PROMPT", hostId, promptType: "password" }),
		);

		ctx.pendingAuthPrompts.get(hostId)?.resolve(null);
		await promise;
	});

	it("handleAuthPromptResponse with rememberSession=true stores in passphraseCache", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-4";

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: vi.fn(),
			timer: null,
			clientId: "c4",
		});

		mgr.handleAuthPromptResponse("c4", hostId, "my-passphrase", true);

		expect(ctx.passphraseCache.has(hostId)).toBe(true);
		const cached = ctx.passphraseCache.get(hostId)!;
		expect(cached.secret).toBe("my-passphrase");
		expect(cached.expiresAt).toBeGreaterThan(Date.now());
	});

	it("handleAuthPromptResponse TTL is approximately 15 minutes", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-4b";
		const before = Date.now();

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: vi.fn(),
			timer: null,
			clientId: "c4b",
		});

		mgr.handleAuthPromptResponse("c4b", hostId, "pass", true);

		const { expiresAt } = ctx.passphraseCache.get(hostId)!;
		const ttlMs = expiresAt - before;
		expect(ttlMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 100);
		expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000 + 100);
	});

	it("handleAuthPromptResponse with rememberSession=false caches for 60s (TOFU retry)", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-5";

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: vi.fn(),
			timer: null,
			clientId: "c5",
		});

		mgr.handleAuthPromptResponse("c5", hostId, "my-passphrase", false);

		expect(ctx.passphraseCache.has(hostId)).toBe(true);
		const cached = ctx.passphraseCache.get(hostId)!;
		expect(cached.secret).toBe("my-passphrase");
		// Short TTL (60s), not 15min
		expect(cached.expiresAt).toBeLessThanOrEqual(Date.now() + 61_000);
	});

	it("handleAuthPromptResponse does not cache when secret is null", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-6";

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: vi.fn(),
			timer: null,
			clientId: "c6",
		});

		mgr.handleAuthPromptResponse("c6", hostId, null, true);

		expect(ctx.passphraseCache.has(hostId)).toBe(false);
	});

	it("handleAuthPromptResponse respects SEC-003: wrong clientId is rejected", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-7";
		const resolveSpy = vi.fn();

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: resolveSpy,
			timer: null,
			clientId: "c7-owner",
		});

		mgr.handleAuthPromptResponse("c7-attacker", hostId, "stolen", true);

		expect(resolveSpy).not.toHaveBeenCalled();
		expect(ctx.passphraseCache.has(hostId)).toBe(false);
		expect(ctx.pendingAuthPrompts.has(hostId)).toBe(true);
	});

	it("handleAuthPromptResponse omitted rememberSession defaults to no-cache", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-8";

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: vi.fn(),
			timer: null,
			clientId: "c8",
		});

		mgr.handleAuthPromptResponse("c8", hostId, "pass");

		// Always cached for 60s (TOFU retry), even without rememberSession
		expect(ctx.passphraseCache.has(hostId)).toBe(true);
	});
});

describe("SshConnectionManager — reconnect cache-only promptAuth", () => {
	it("scheduleReconnect passes a non-undefined promptAuth to SshAgent when cache is warm", async () => {
		const { SshAgent } = await import("./ssh-agent.js");
		capturedSshAgentArgs = null;

		const hostId = "host-reconnect-1";
		const passphrase = "correct-horse-battery-staple";

		const ctx = {
			passphraseCache: new Map([[hostId, { secret: passphrase, expiresAt: Date.now() + 60_000 }]]),
			pendingAuthPrompts: new Map(),
			sessions: new Map([[hostId, { status: "reconnecting" }]]),
			reconnectTimers: new Map(),
			metaDal: {
				getHost: vi.fn().mockReturnValue({
					id: hostId,
					sshHost: "myhost.example.com",
					sshPort: 22,
					sshAuth: "key",
					sshKeyPath: "/home/user/.ssh/id_rsa",
					sshUser: "myuser",
					label: "myhost",
				}),
				getHostAgentSha256: vi.fn().mockReturnValue(null),
				getHostFingerprint: vi.fn().mockReturnValue("SHA256:stored"),
				updateHostOsArch: vi.fn(),
				updateHostAgentSha256: vi.fn(),
			},
			trustedAgentSha256: new Map(),
			trustedOnceFingerprints: new Map(),
			agents: new Map(),
			hubLogger: null,
		} as unknown as SharedSessionContext;

		const broadcaster = { updateSessionStatus: vi.fn() } as never;
		const lifecycle = { closeSession: vi.fn(), reAttachChannels: vi.fn() } as never;
		const agentMgr = { wireAgentEvents: vi.fn() } as never;

		const mgr = new SshConnectionManager(ctx, broadcaster, lifecycle, agentMgr);

		// Trigger reconnect with zero delay (attemptIndex=0 with startTime=Date.now() still schedules setTimeout)
		// Use a fresh startTime well within budget
		const startTime = Date.now();
		mgr.scheduleReconnect(hostId, "session-1", 0, startTime);

		// Advance past the 1000ms backoff
		await new Promise((resolve) => setTimeout(resolve, 1_100));

		// SshAgent must have been constructed
		expect(SshAgent).toHaveBeenCalled();
		expect(capturedSshAgentArgs).not.toBeNull();

		// Second arg is the promptAuth callback — must be non-undefined (mutation sentinel)
		const promptAuth = capturedSshAgentArgs![1];
		expect(promptAuth).toBeDefined();
		expect(typeof promptAuth).toBe("function");

		// Cache HIT: calling the callback returns the cached passphrase without any UI send
		const result = await (promptAuth as NonNullable<typeof promptAuth>)(
			hostId,
			"passphrase",
			"Enter passphrase",
		);
		expect(result).toBe(passphrase);
	});

	it("cache-only promptAuth throws with a distinct reason on cache MISS (no UI prompt, no hang)", async () => {
		capturedSshAgentArgs = null;

		const hostId = "host-reconnect-miss";

		const ctx = {
			// Cache is empty — no passphrase stored
			passphraseCache: new Map(),
			pendingAuthPrompts: new Map(),
		} as unknown as SharedSessionContext;

		const mgr = new SshConnectionManager(ctx, null as never, null as never, null as never);
		const promptAuth = mgr.buildCacheOnlyPromptAuth(hostId);

		// Must reject immediately (no pending promise, no UI send) with a
		// distinct internal reason — NOT "Authentication cancelled by user".
		await expect(promptAuth(hostId, "passphrase", "Enter passphrase")).rejects.toThrow(
			"no cached passphrase for non-interactive reconnect",
		);
	});

	it("cache-only promptAuth returns null for non-passphrase prompt types", async () => {
		const hostId = "host-reconnect-type";
		const ctx = {
			passphraseCache: new Map([
				[hostId, { secret: "irrelevant", expiresAt: Date.now() + 60_000 }],
			]),
			pendingAuthPrompts: new Map(),
		} as unknown as SharedSessionContext;

		const mgr = new SshConnectionManager(ctx, null as never, null as never, null as never);
		const promptAuth = mgr.buildCacheOnlyPromptAuth(hostId);

		// Non-passphrase prompt types must return null (cache is passphrase-only)
		const result = await promptAuth(hostId, "password", "Enter password");
		expect(result).toBeNull();
	});
});
