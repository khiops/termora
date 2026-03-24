
import { createApp, defineComponent, ref, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFILE } from "@nexterm/shared";
import type { ProfileChangeEvent } from "../stores/config.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mount a composable inside a minimal Vue app to activate lifecycle hooks. */
function withSetup<T>(setup: () => T): { result: T; unmount: () => void } {
	let result!: T;
	const app = createApp(
		defineComponent({
			setup() {
				result = setup();
				return {};
			},
			template: "<div />",
		}),
	);
	app.use(createPinia());
	const el = document.createElement("div");
	app.mount(el);
	return { result, unmount: () => app.unmount() };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

// We mock the stores and fetch rather than exercising real HTTP
vi.mock("../stores/config.js", () => {
	let listeners = new Set<(e: ProfileChangeEvent) => void>();
	return {
		useConfigStore: () => ({
			onProfileChange(cb: (e: ProfileChangeEvent) => void) {
				listeners.add(cb);
				return () => listeners.delete(cb);
			},
			_emit(event: ProfileChangeEvent) {
				for (const cb of listeners) cb(event);
			},
			_reset() {
				listeners = new Set();
			},
		}),
	};
});

vi.mock("../stores/auth.js", () => ({
	useAuthStore: () => ({ token: "test-token" }),
}));

vi.mock("../utils/hub-url.js", () => ({
	hubBaseUrl: () => "http://hub",
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useResolvedProfile", () => {
	// Import after mocks are defined
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	let useResolvedProfile: typeof import("./useResolvedProfile.js").useResolvedProfile;
	let useConfigStore: () => ReturnType<typeof import("../stores/config.js").useConfigStore> & {
		_emit: (e: ProfileChangeEvent) => void;
		_reset: () => void;
	};

	beforeEach(async () => {
		setActivePinia(createPinia());
		vi.clearAllMocks();
		const mod = await import("./useResolvedProfile.js");
		useResolvedProfile = mod.useResolvedProfile;
		const configMod = await import("../stores/config.js");
		// biome-ignore lint/suspicious/noExplicitAny: test helper cast
		useConfigStore = configMod.useConfigStore as any;
		useConfigStore()._reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fetches resolved profile on mount with no context", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ ...DEFAULT_PROFILE, fontSize: 18 }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const hostId = ref<string | undefined>(undefined);
		const channelId = ref<string | undefined>(undefined);

		const { result, unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();

		expect(fetchMock).toHaveBeenCalledWith(
			"http://hub/api/config/resolved",
			expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
		);
		expect(result.profile.value.fontSize).toBe(18);
		unmount();
	});

	it("fetches resolved profile on mount with host_id and channel_id", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ ...DEFAULT_PROFILE, fontSize: 20 }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const hostId = ref<string | undefined>("host-1");
		const channelId = ref<string | undefined>("ch-1");

		const { result, unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();

		expect(fetchMock).toHaveBeenCalledWith(
			"http://hub/api/config/resolved?host_id=host-1&channel_id=ch-1",
			expect.anything(),
		);
		expect(result.profile.value.fontSize).toBe(20);
		unmount();
	});

	it("re-fetches on global profile change event", async () => {
		let callCount = 0;
		const fetchMock = vi.fn().mockImplementation(async () => ({
			ok: true,
			json: async () => ({ ...DEFAULT_PROFILE, fontSize: 14 + callCount++ }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const hostId = ref<string | undefined>("host-1");
		const channelId = ref<string | undefined>(undefined);

		const { unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Emit a global change — should trigger re-fetch
		useConfigStore()._emit({ scope: "global" });
		await nextTick();
		await nextTick();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		unmount();
	});

	it("re-fetches on matching host profile change event", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => DEFAULT_PROFILE,
		});
		vi.stubGlobal("fetch", fetchMock);

		const hostId = ref<string | undefined>("host-1");
		const channelId = ref<string | undefined>(undefined);

		const { unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Emit a host change for a different host — should NOT re-fetch
		useConfigStore()._emit({ scope: "host", hostId: "host-2" });
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Emit a host change for our host — should re-fetch
		useConfigStore()._emit({ scope: "host", hostId: "host-1" });
		await nextTick();
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		unmount();
	});

	it("re-fetches on matching channel profile change event", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => DEFAULT_PROFILE,
		});
		vi.stubGlobal("fetch", fetchMock);

		const hostId = ref<string | undefined>("host-1");
		const channelId = ref<string | undefined>("ch-1");

		const { unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Emit a channel change for a different channel — should NOT re-fetch
		useConfigStore()._emit({ scope: "channel", channelId: "ch-99" });
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Emit a channel change for our channel — should re-fetch
		useConfigStore()._emit({ scope: "channel", channelId: "ch-1" });
		await nextTick();
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		unmount();
	});

	it("unsubscribes from profile change events on unmount", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => DEFAULT_PROFILE,
		});
		vi.stubGlobal("fetch", fetchMock);

		const hostId = ref<string | undefined>(undefined);
		const channelId = ref<string | undefined>(undefined);

		const { unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();
		const countAfterMount = fetchMock.mock.calls.length;

		unmount();
		await nextTick();

		// After unmount, global events should NOT trigger re-fetch
		useConfigStore()._emit({ scope: "global" });
		await nextTick();
		await nextTick();
		expect(fetchMock).toHaveBeenCalledTimes(countAfterMount);
	});

	it("keeps DEFAULT_PROFILE when fetch fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const hostId = ref<string | undefined>(undefined);
		const channelId = ref<string | undefined>(undefined);

		const { result, unmount } = withSetup(() =>
			useResolvedProfile(hostId, channelId),
		);

		await nextTick();
		await nextTick();

		// Should fall back to DEFAULT_PROFILE
		expect(result.profile.value.fontSize).toBe(DEFAULT_PROFILE.fontSize);
		expect(warnSpy).toHaveBeenCalledWith(
			"[useResolvedProfile] failed to load:",
			expect.any(Error),
		);
		unmount();
	});
});
