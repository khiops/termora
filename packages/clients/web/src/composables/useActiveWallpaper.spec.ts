import { DEFAULT_PROFILE, type TerminalProfile } from "@termora/shared";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, nextTick, ref } from "vue";
import type { ProfileChangeEvent } from "../stores/config.js";
import type { PaneNode } from "./usePaneTree.js";

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

async function flushAsync(): Promise<void> {
	await nextTick();
	await Promise.resolve();
	await Promise.resolve();
	await nextTick();
}

vi.mock("../stores/config.js", () => {
	let listeners = new Set<(e: ProfileChangeEvent) => void>();
	return {
		useConfigStore: () => ({
			onProfileChange(cb: (e: ProfileChangeEvent) => void) {
				listeners.add(cb);
				return () => listeners.delete(cb);
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

vi.mock("../utils/hub-url.js", async () => {
	const vue = await vi.importActual<typeof import("vue")>("vue");
	return {
		hubBaseUrl: () => "http://hub",
		hubPortReady: vue.ref(true),
	};
});

describe("useActiveWallpaper", () => {
	let useActiveWallpaper: typeof import("./useActiveWallpaper.js").useActiveWallpaper;
	let unresolvedWallpaperFallbackMs: number;
	let usePaneTree: typeof import("./usePaneTree.js").usePaneTree;
	let useConfigStore: () => ReturnType<typeof import("../stores/config.js").useConfigStore> & {
		_reset: () => void;
	};

	beforeEach(async () => {
		setActivePinia(createPinia());
		vi.clearAllMocks();
		const activeWallpaperMod = await import("./useActiveWallpaper.js");
		const paneTreeMod = await import("./usePaneTree.js");
		const configMod = await import("../stores/config.js");
		useActiveWallpaper = activeWallpaperMod.useActiveWallpaper;
		unresolvedWallpaperFallbackMs = activeWallpaperMod.UNRESOLVED_WALLPAPER_FALLBACK_MS;
		usePaneTree = paneTreeMod.usePaneTree;
		// biome-ignore lint/suspicious/noExplicitAny: test helper cast
		useConfigStore = configMod.useConfigStore as any;
		useConfigStore()._reset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("resolves the window wallpaper from the active pane and updates when focus changes", async () => {
		const profilesByChannel: Record<string, Partial<TerminalProfile>> = {
			"ch-a": { wallpaper: "alpha.jpg", wallpaperBlur: 4, wallpaperDim: 25 },
			"ch-b": { wallpaper: "beta.png", wallpaperBlur: 0, wallpaperDim: 40 },
			"ch-c": { wallpaper: "", wallpaperBlur: 0, wallpaperDim: 0 },
		};
		const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			const channelId = url.searchParams.get("channel_id") ?? "";
			return {
				ok: true,
				json: async () => ({
					terminal: {
						resolved: {
							...DEFAULT_PROFILE,
							...profilesByChannel[channelId],
						},
					},
				}),
			};
		});
		vi.stubGlobal("fetch", fetchMock);

		const { result, unmount } = withSetup(() => {
			const tabs = ref([{ id: "tab-1" }]);
			const activeTabIndex = ref(0);
			const layouts = ref<Record<string, PaneNode | null>>({
				"tab-1": {
					type: "split",
					direction: "vertical",
					ratio: 0.5,
					first: { type: "terminal", channelId: "ch-a", paneId: "pane-a" },
					second: {
						type: "split",
						direction: "horizontal",
						ratio: 0.5,
						first: { type: "terminal", channelId: "ch-b", paneId: "pane-b" },
						second: { type: "terminal", channelId: "ch-c", paneId: "pane-c" },
					},
				},
			});
			const activePaneIds = ref<Record<string, string>>({ "tab-1": "pane-a" });
			const paneTree = usePaneTree(tabs, activeTabIndex, layouts, activePaneIds);
			const channelHostMap = ref<ReadonlyMap<string, string>>(
				new Map([
					["ch-a", "host-1"],
					["ch-b", "host-1"],
					["ch-c", "host-1"],
				]),
			);
			const wallpaper = useActiveWallpaper({
				activeTab: paneTree.activeTab,
				getActiveChannelId: paneTree.getActiveChannelId,
				channelHostMap,
			});

			return {
				...wallpaper,
				activeTabIndex,
				setActivePaneId: paneTree.setActivePaneId,
			};
		});

		await flushAsync();

		expect(result.activeChannelId.value).toBe("ch-a");
		expect(result.activeHostId.value).toBe("host-1");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		expect(result.wallpaperStyle.value?.filter).toBe("blur(4px)");
		expect(result.dimStyle.value?.background).toBe("rgba(0, 0, 0, 0.25)");

		result.setActivePaneId("tab-1", "pane-b");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		await flushAsync();

		expect(result.activeChannelId.value).toBe("ch-b");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("beta.png");
		expect(result.wallpaperStyle.value?.filter).toBeUndefined();
		expect(result.dimStyle.value?.background).toBe("rgba(0, 0, 0, 0.4)");

		result.setActivePaneId("tab-1", "pane-c");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("beta.png");
		await flushAsync();

		expect(result.activeChannelId.value).toBe("ch-c");
		expect(result.wallpaperStyle.value).toBeNull();
		expect(result.dimStyle.value).toBeNull();

		result.setActivePaneId("tab-1", "pane-b");

		expect(result.activeChannelId.value).toBe("ch-b");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("beta.png");
		expect(result.dimStyle.value?.background).toBe("rgba(0, 0, 0, 0.4)");

		result.activeTabIndex.value = 1;
		await nextTick();

		expect(result.activeChannelId.value).toBeNull();
		expect(result.wallpaperStyle.value).toBeNull();

		unmount();
	});

	it("serves cached scopes immediately and bounds uncached transitional wallpapers", async () => {
		vi.useFakeTimers();

		type CascadeResponse = {
			ok: true;
			json: () => Promise<{ terminal: { resolved: TerminalProfile } }>;
		};
		type PendingCascade = {
			channelId: string;
			hostId: string | null;
			resolve: (response: CascadeResponse) => void;
		};
		const pending: PendingCascade[] = [];
		const fetchMock = vi.fn((input: RequestInfo | URL): Promise<CascadeResponse> => {
			const url = new URL(String(input));
			return new Promise((resolve) => {
				pending.push({
					channelId: url.searchParams.get("channel_id") ?? "",
					hostId: url.searchParams.get("host_id"),
					resolve,
				});
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		function resolvePending(channelId: string, profile: Partial<TerminalProfile>): void {
			const index = pending.findIndex((request) => request.channelId === channelId);
			expect(index).toBeGreaterThanOrEqual(0);
			const [request] = pending.splice(index, 1);
			if (request === undefined) throw new Error(`No pending request for ${channelId}`);
			request.resolve({
				ok: true,
				json: async () => ({
					terminal: {
						resolved: {
							...DEFAULT_PROFILE,
							...profile,
						},
					},
				}),
			});
		}

		const { result, unmount } = withSetup(() => {
			const activeTab = ref({ id: "tab-a" });
			const channelsByTab: Record<string, string> = {
				"tab-a": "ch-a",
				"tab-b": "ch-b",
				"tab-c": "ch-c",
			};
			const channelHostMap = ref<ReadonlyMap<string, string>>(
				new Map([
					["ch-a", "host-1"],
					["ch-b", "host-1"],
					["ch-c", "host-2"],
				]),
			);
			const wallpaper = useActiveWallpaper({
				activeTab,
				getActiveChannelId: (tabId) => channelsByTab[tabId] ?? null,
				channelHostMap,
			});

			return {
				...wallpaper,
				activeTab,
			};
		});

		await flushAsync();
		resolvePending("ch-a", { wallpaper: "alpha.jpg", wallpaperBlur: 0, wallpaperDim: 20 });
		await flushAsync();

		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		expect(result.dimStyle.value?.background).toBe("rgba(0, 0, 0, 0.2)");

		result.activeTab.value = { id: "tab-b" };

		expect(result.activeChannelId.value).toBe("ch-b");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		await flushAsync();
		expect(pending.some((request) => request.channelId === "ch-b")).toBe(true);

		await vi.advanceTimersByTimeAsync(unresolvedWallpaperFallbackMs);
		await nextTick();

		expect(result.wallpaperStyle.value).toBeNull();
		expect(result.dimStyle.value).toBeNull();

		resolvePending("ch-b", { wallpaper: "beta.png", wallpaperBlur: 3, wallpaperDim: 30 });
		await flushAsync();

		expect(result.wallpaperStyle.value?.backgroundImage).toContain("beta.png");
		expect(result.wallpaperStyle.value?.filter).toBe("blur(3px)");

		result.activeTab.value = { id: "tab-a" };

		expect(result.activeChannelId.value).toBe("ch-a");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		await flushAsync();

		result.activeTab.value = { id: "tab-c" };

		expect(result.activeChannelId.value).toBe("ch-c");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		await flushAsync();
		await vi.advanceTimersByTimeAsync(unresolvedWallpaperFallbackMs);
		await nextTick();

		expect(result.wallpaperStyle.value).toBeNull();

		result.activeTab.value = { id: "tab-a" };
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		await flushAsync();

		resolvePending("ch-c", { wallpaper: "charlie.webp", wallpaperBlur: 0, wallpaperDim: 0 });
		await flushAsync();

		expect(result.activeChannelId.value).toBe("ch-a");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");

		result.activeTab.value = { id: "tab-c" };

		expect(result.activeChannelId.value).toBe("ch-c");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("alpha.jpg");
		await flushAsync();

		resolvePending("ch-c", { wallpaper: "charlie.webp", wallpaperBlur: 0, wallpaperDim: 0 });
		await flushAsync();

		expect(result.wallpaperStyle.value?.backgroundImage).toContain("charlie.webp");

		unmount();
	});

	it("omits host context for an unmapped active channel and updates when the map is populated", async () => {
		const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			const hostId = url.searchParams.get("host_id");
			const wallpaper = hostId === "host-correct" ? "correct.jpg" : "global.jpg";

			return {
				ok: true,
				json: async () => ({
					terminal: {
						resolved: {
							...DEFAULT_PROFILE,
							wallpaper,
							wallpaperBlur: 0,
							wallpaperDim: 0,
						},
					},
				}),
			};
		});
		vi.stubGlobal("fetch", fetchMock);

		const { result, unmount } = withSetup(() => {
			const activeTab = ref({ id: "tab-1" });
			const channelHostMap = ref<ReadonlyMap<string, string>>(new Map());
			const wallpaper = useActiveWallpaper({
				activeTab,
				getActiveChannelId: () => "ch-late",
				channelHostMap,
			});

			return {
				...wallpaper,
				channelHostMap,
			};
		});

		await flushAsync();

		expect(result.activeChannelId.value).toBe("ch-late");
		expect(result.activeHostId.value).toBeNull();
		const initialUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
		expect(initialUrl.searchParams.get("channel_id")).toBe("ch-late");
		expect(initialUrl.searchParams.has("host_id")).toBe(false);
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("global.jpg");

		result.channelHostMap.value = new Map([["ch-late", "host-correct"]]);
		await flushAsync();

		expect(result.activeHostId.value).toBe("host-correct");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const mappedUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
		expect(mappedUrl.searchParams.get("host_id")).toBe("host-correct");
		expect(mappedUrl.searchParams.get("channel_id")).toBe("ch-late");
		expect(result.wallpaperStyle.value?.backgroundImage).toContain("correct.jpg");

		unmount();
	});
});
