import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelsStore } from "./channels.js";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

// fetch is called by fetchGroups — stub it to return a controllable response
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const COLLAPSED_KEY = "nexterm:collapsed-groups";

function makeGroupRow(id: string, name = "Group"): Record<string, unknown> {
	return {
		id,
		host_id: "host-1",
		name,
		sort_order: 0,
		created_at: "2026-01-01T00:00:00Z",
	};
}

function stubGroups(rows: Record<string, unknown>[]): void {
	mockFetch.mockImplementation((url: string) => {
		const body = url.includes("/api/groups") ? rows : [];
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(body),
		});
	});
}

/** Parse the collapsed map stored in localStorage, or return null if absent. */
function readCollapsedMap(): Record<string, boolean> | null {
	const raw = localStorage.getItem(COLLAPSED_KEY);
	if (raw === null) return null;
	return JSON.parse(raw) as Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
	localStorageMap.clear();
	mockFetch.mockReset();
	setActivePinia(createPinia());
	// Seed auth token so fetchGroups doesn't early-return (TOKEN_KEY = "nexterm_token")
	localStorageMap.set("nexterm_token", "test-token");
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// toggleGroupCollapsed — persists to localStorage
// ---------------------------------------------------------------------------

describe("useChannelsStore — toggleGroupCollapsed", () => {
	it("persists collapsed=true for a group on first toggle", async () => {
		stubGroups([makeGroupRow("g1")]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");

		store.toggleGroupCollapsed("g1");

		const map = readCollapsedMap();
		expect(map).not.toBeNull();
		expect(map?.g1).toBe(true);
	});

	it("persists collapsed=false on second toggle (expand)", async () => {
		stubGroups([makeGroupRow("g1")]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");

		store.toggleGroupCollapsed("g1"); // collapse
		store.toggleGroupCollapsed("g1"); // expand

		const map = readCollapsedMap();
		expect(map?.g1).toBe(false);
	});

	it("restores collapsed state when fetchGroups is called", async () => {
		// Pre-seed localStorage with a collapsed group
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ g1: true }));

		stubGroups([makeGroupRow("g1"), makeGroupRow("g2")]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");

		const g1 = store.groups.find((g) => g.id === "g1");
		const g2 = store.groups.find((g) => g.id === "g2");
		expect(g1?.collapsed).toBe(true);
		expect(g2?.collapsed).toBe(false);
	});

	it("does not affect __general__ entry when toggling a real group", async () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ __general__: true }));
		stubGroups([makeGroupRow("g1")]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");

		store.toggleGroupCollapsed("g1");

		const map = readCollapsedMap();
		// __general__ must survive the group toggle unchanged
		expect(map?.__general__).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// toggleGeneralCollapsed — persists to localStorage under __general__
// ---------------------------------------------------------------------------

describe("useChannelsStore — toggleGeneralCollapsed", () => {
	it("starts false by default", () => {
		const store = useChannelsStore();
		expect(store.generalCollapsed).toBe(false);
	});

	it("toggles generalCollapsed to true on first call", () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();
		expect(store.generalCollapsed).toBe(true);
	});

	it("toggles back to false on second call", () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();
		store.toggleGeneralCollapsed();
		expect(store.generalCollapsed).toBe(false);
	});

	it("writes __general__=true to localStorage on collapse", () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();

		const map = readCollapsedMap();
		expect(map).not.toBeNull();
		expect(map?.__general__).toBe(true);
	});

	it("writes __general__=false to localStorage on expand", () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed(); // collapse
		store.toggleGeneralCollapsed(); // expand

		const map = readCollapsedMap();
		expect(map?.__general__).toBe(false);
	});

	it("does not overwrite other group entries in localStorage", () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ g1: true, g2: false }));
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();

		const map = readCollapsedMap();
		expect(map?.g1).toBe(true);
		expect(map?.g2).toBe(false);
		expect(map?.__general__).toBe(true);
	});

	it("restores generalCollapsed=true from localStorage after fetchGroups", async () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ __general__: true }));
		stubGroups([]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");
		expect(store.generalCollapsed).toBe(true);
	});

	it("restores generalCollapsed=false when __general__ is absent from localStorage", async () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ g1: true }));
		stubGroups([]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");
		expect(store.generalCollapsed).toBe(false);
	});

	it("handles corrupt localStorage gracefully — defaults to false", async () => {
		localStorageMap.set(COLLAPSED_KEY, "not-valid-json{{{");
		stubGroups([]);
		const store = useChannelsStore();
		await store.fetchChannels("host-1");
		expect(store.generalCollapsed).toBe(false);
	});
});
