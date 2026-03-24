
import { describe, expect, it, vi } from "vitest";
import type { SharedSessionContext } from "./session-context.js";
import { SshConnectionManager } from "./ssh-connection-manager.js";

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

	it("handleAuthPromptResponse with rememberSession=false does not cache", () => {
		const ctx = makeCtx();
		const mgr = makeMgr(ctx);
		const hostId = "host-5";

		ctx.pendingAuthPrompts.set(hostId, {
			resolve: vi.fn(),
			timer: null,
			clientId: "c5",
		});

		mgr.handleAuthPromptResponse("c5", hostId, "my-passphrase", false);

		expect(ctx.passphraseCache.has(hostId)).toBe(false);
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

		expect(ctx.passphraseCache.has(hostId)).toBe(false);
	});
});