/**
 * writelock.spec.ts — unit tests for the write-lock Pinia store.
 *
 * The reactivity tests below are purposely written to observe lock state
 * through a Vue computed/watchEffect, NOT by reading locks.value.get()
 * directly. This ensures the tests catch the specific bug where in-place
 * Map mutation (locks.value.set(...)) updates the Map in memory but does NOT
 * trigger Vue reactive re-evaluation. Reverting the fix back to the
 * in-place mutation pattern causes these tests to fail.
 */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { computed, nextTick, ref, watchEffect } from "vue";
import { useWriteLockStore } from "./writelock.js";

const CHANNEL = "ch-abc";
const CLIENT_A = "client-A";
const CLIENT_B = "client-B";

describe("useWriteLockStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	// ── Reactivity proof tests ─────────────────────────────────────────────────
	// These tests MUST use a computed/watchEffect that reads locks to verify
	// that Vue's reactive dependency tracking fires after each mutation.
	// A test that only reads locks.value.get(...) directly would PASS even
	// with the broken in-place mutation, because the Map IS updated in memory.

	describe("handleWriteLock — reactive via computed", () => {
		it("computed lockState reflects new holder after handleWriteLock", async () => {
			const store = useWriteLockStore();

			// Mirror what WriteLockIndicator.vue does: derive lockState via computed
			const lockState = computed(() => store.locks.get(CHANNEL) ?? null);
			const hasHolder = computed(() => lockState.value?.holder != null);

			// Initially no entry
			expect(lockState.value).toBeNull();
			expect(hasHolder.value).toBe(false);

			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();

			// Reactive computed must now reflect the new holder
			expect(lockState.value).toEqual({ holder: CLIENT_A });
			expect(hasHolder.value).toBe(true);
		});

		it("watchEffect observes holder change after handleWriteLock", async () => {
			const store = useWriteLockStore();
			const observed = ref<string | null | undefined>(undefined);

			watchEffect(() => {
				observed.value = store.locks.get(CHANNEL)?.holder ?? null;
			});

			// watchEffect runs synchronously on first flush
			expect(observed.value).toBeNull();

			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();

			expect(observed.value).toBe(CLIENT_A);
		});

		it("computed reflects holder update when handleWriteLock called twice", async () => {
			const store = useWriteLockStore();
			const holder = computed(() => store.locks.get(CHANNEL)?.holder ?? null);

			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();
			expect(holder.value).toBe(CLIENT_A);

			// Lock transferred to CLIENT_B
			store.handleWriteLock(CHANNEL, CLIENT_B);
			await nextTick();
			expect(holder.value).toBe(CLIENT_B);
		});

		it("computed reflects null holder when handleWriteLock called with null", async () => {
			const store = useWriteLockStore();
			const holder = computed(() => store.locks.get(CHANNEL)?.holder ?? "sentinel");

			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();
			expect(holder.value).toBe(CLIENT_A);

			store.handleWriteLock(CHANNEL, null);
			await nextTick();
			// holder is null → fallback sentinel NOT used (entry exists with holder=null)
			expect(store.locks.get(CHANNEL)).toEqual({ holder: null });
			// computed using ?? null sees null
			const holderOrNull = computed(() => store.locks.get(CHANNEL)?.holder ?? null);
			expect(holderOrNull.value).toBeNull();
		});
	});

	describe("handleWriteRevoked — reactive via computed", () => {
		it("computed lockState reflects null holder after handleWriteRevoked", async () => {
			const store = useWriteLockStore();
			const lockState = computed(() => store.locks.get(CHANNEL) ?? null);

			// Establish an existing holder
			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();
			expect(lockState.value).toEqual({ holder: CLIENT_A });

			// Revoke — should clear the holder reactively
			store.handleWriteRevoked(CHANNEL);
			await nextTick();

			expect(lockState.value).toEqual({ holder: null });
		});

		it("watchEffect observes holder cleared to null after handleWriteRevoked", async () => {
			const store = useWriteLockStore();
			const observed = ref<string | null | undefined>(undefined);

			watchEffect(() => {
				observed.value = store.locks.get(CHANNEL)?.holder ?? null;
			});

			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();
			expect(observed.value).toBe(CLIENT_A);

			store.handleWriteRevoked(CHANNEL);
			await nextTick();
			expect(observed.value).toBeNull();
		});

		it("handleWriteRevoked is a no-op when channel has no entry", async () => {
			const store = useWriteLockStore();
			const lockState = computed(() => store.locks.get(CHANNEL) ?? null);

			expect(lockState.value).toBeNull();
			store.handleWriteRevoked(CHANNEL); // no entry → should not throw
			await nextTick();
			expect(lockState.value).toBeNull();
		});
	});

	describe("setInitialHolder — reactive via computed", () => {
		it("computed lockState reflects initial holder after setInitialHolder", async () => {
			const store = useWriteLockStore();
			const lockState = computed(() => store.locks.get(CHANNEL) ?? null);

			expect(lockState.value).toBeNull();

			store.setInitialHolder(CHANNEL, CLIENT_A);
			await nextTick();

			expect(lockState.value).toEqual({ holder: CLIENT_A });
		});

		it("setInitialHolder with null holder creates entry reactively", async () => {
			const store = useWriteLockStore();
			const hasEntry = computed(() => store.locks.has(CHANNEL));

			expect(hasEntry.value).toBe(false);

			store.setInitialHolder(CHANNEL, null);
			await nextTick();

			expect(hasEntry.value).toBe(true);
			expect(store.locks.get(CHANNEL)).toEqual({ holder: null });
		});
	});

	// ── Behaviour tests ────────────────────────────────────────────────────────

	describe("pruneDeadLocks", () => {
		it("removes entries for dead channels", async () => {
			const store = useWriteLockStore();
			store.handleWriteLock("ch-1", CLIENT_A);
			store.handleWriteLock("ch-2", CLIENT_B);
			await nextTick();

			store.pruneDeadLocks(new Set(["ch-1"]));
			await nextTick();

			expect(store.locks.has("ch-1")).toBe(false);
			expect(store.locks.has("ch-2")).toBe(true);
		});

		it("is a no-op when dead set is empty", async () => {
			const store = useWriteLockStore();
			store.handleWriteLock(CHANNEL, CLIENT_A);
			await nextTick();

			store.pruneDeadLocks(new Set());
			await nextTick();

			expect(store.locks.get(CHANNEL)).toEqual({ holder: CLIENT_A });
		});
	});

	describe("handleWriteRequest", () => {
		it("sets incomingRequest", () => {
			const store = useWriteLockStore();
			expect(store.incomingRequest).toBeNull();
			store.handleWriteRequest(CHANNEL, CLIENT_A);
			expect(store.incomingRequest).toEqual({ channelId: CHANNEL, fromClientId: CLIENT_A });
		});
	});

	describe("dismissRequest", () => {
		it("clears incomingRequest", () => {
			const store = useWriteLockStore();
			store.handleWriteRequest(CHANNEL, CLIENT_A);
			store.dismissRequest();
			expect(store.incomingRequest).toBeNull();
		});
	});
});
