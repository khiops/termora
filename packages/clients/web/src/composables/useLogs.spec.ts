import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "./useLogs.js";

// ---------------------------------------------------------------------------
// Stubs — must be registered before any module import resolves the stores
// ---------------------------------------------------------------------------

const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Deferred import so that stubs are in place before the module is evaluated
const { useLogs } = await import("./useLogs.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return { lvl: "info", msg: "test message", ...overrides };
}

function stubFetch(response: { ok: boolean; entries?: LogEntry[]; total?: number; status?: number; statusText?: string }): void {
	if (response.ok) {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					entries: response.entries ?? [],
					total: response.total ?? 0,
				}),
		});
	} else {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: response.status ?? 500,
			statusText: response.statusText ?? "Internal Server Error",
		});
	}
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

beforeEach(() => {
	localStorageMap.clear();
	// Seed auth token so useLogs doesn't short-circuit with "Not authenticated"
	localStorageMap.set("termora_token", "test-token");
	setActivePinia(createPinia());
	mockFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useLogs — initial state", () => {
	it("returns empty entries, zero total, not loading, no error on creation", () => {
		const { entries, total, loading, error } = useLogs({});

		expect(entries.value).toStrictEqual([]);
		expect(total.value).toBe(0);
		expect(loading.value).toBe(false);
		expect(error.value).toBeNull();
	});
});

describe("useLogs — hub logs (no channelId)", () => {
	it("fetches hub logs from /api/logs/hub", async () => {
		const logEntry = makeEntry({ lvl: "info", msg: "hub started", ts: "2026-01-01T00:00:00Z" });
		stubFetch({ ok: true, entries: [logEntry], total: 1 });

		const { entries, total, loading, error, fetch } = useLogs({});

		await fetch();

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/logs/hub");
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-token");

		expect(loading.value).toBe(false);
		expect(error.value).toBeNull();
		expect(entries.value).toHaveLength(1);
		expect(entries.value[0]?.msg).toBe("hub started");
		expect(total.value).toBe(1);
	});

	it("passes level filter as query param", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { fetch } = useLogs({});
		await fetch({ level: "error" });

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("level=error");
	});

	it("passes search filter as query param", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { fetch } = useLogs({});
		await fetch({ search: "crash" });

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("search=crash");
	});

	it("passes limit query param (default 100)", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { fetch } = useLogs({});
		await fetch();

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("limit=100");
	});

	it("respects custom limit option", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { fetch } = useLogs({ limit: 25 });
		await fetch();

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("limit=25");
	});

	it("sets offset=0 on initial fetch (not loadMore)", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { fetch } = useLogs({});
		await fetch();

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("offset=0");
	});

	it("replaces entries (not appends) on subsequent fetch calls", async () => {
		const first = [makeEntry({ msg: "first" })];
		const second = [makeEntry({ msg: "second" }), makeEntry({ msg: "third" })];

		stubFetch({ ok: true, entries: first, total: 1 });
		const { entries, fetch } = useLogs({});
		await fetch();
		expect(entries.value).toHaveLength(1);

		stubFetch({ ok: true, entries: second, total: 2 });
		await fetch();
		expect(entries.value).toHaveLength(2);
		expect(entries.value[0]?.msg).toBe("second");
	});
});

describe("useLogs — channel logs (with channelId)", () => {
	it("fetches channel logs from /api/logs/channels/:id", async () => {
		stubFetch({ ok: true, entries: [makeEntry({ msg: "SPAWN_OK" })], total: 1 });

		const { fetch } = useLogs({ channelId: "ch-abc" });
		await fetch();

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("/api/logs/channels/ch-abc");
	});

	it("URL-encodes channelId", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { fetch } = useLogs({ channelId: "ch abc/special" });
		await fetch();

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("/api/logs/channels/ch%20abc%2Fspecial");
	});
});

describe("useLogs — loading state", () => {
	it("sets loading=true during fetch and restores to false on success", async () => {
		let resolveJson!: (v: unknown) => void;
		const jsonPromise = new Promise((res) => {
			resolveJson = res;
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => jsonPromise,
		});

		const { loading, fetch } = useLogs({});
		const fetchPromise = fetch();

		// In-flight: loading must be true
		expect(loading.value).toBe(true);

		resolveJson({ entries: [], total: 0 });
		await fetchPromise;

		expect(loading.value).toBe(false);
	});

	it("restores loading=false even when fetch resolves with !ok", async () => {
		stubFetch({ ok: false, status: 503, statusText: "Service Unavailable" });

		const { loading, fetch } = useLogs({});
		await fetch();

		expect(loading.value).toBe(false);
	});
});

describe("useLogs — error paths", () => {
	it("sets error when response is not ok", async () => {
		stubFetch({ ok: false, status: 404, statusText: "Not Found" });

		const { error, fetch } = useLogs({});
		await fetch();

		expect(error.value).toBe("Request failed: 404 Not Found");
	});

	it("sets error when fetch throws a network error", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network failure"));

		const { error, fetch } = useLogs({});
		await fetch();

		expect(error.value).toBe("Network failure");
	});

	it("sets error to generic message for non-Error thrown values", async () => {
		mockFetch.mockRejectedValueOnce("oops");

		const { error, fetch } = useLogs({});
		await fetch();

		expect(error.value).toBe("Unknown error");
	});

	it("clears previous error on a new successful fetch", async () => {
		// First call: failure
		stubFetch({ ok: false, status: 500, statusText: "Server Error" });
		const { error, fetch } = useLogs({});
		await fetch();
		expect(error.value).not.toBeNull();

		// Second call: success
		stubFetch({ ok: true, entries: [], total: 0 });
		await fetch();
		expect(error.value).toBeNull();
	});

	it("returns early without fetching when not authenticated", async () => {
		localStorageMap.clear(); // remove token → auth store sees null

		// Re-init Pinia so auth store reads from the now-empty localStorage
		setActivePinia(createPinia());

		const { error, fetch } = useLogs({});
		await fetch();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(error.value).toBe("Not authenticated");
	});
});

describe("useLogs — empty result", () => {
	it("sets entries to empty array and total to 0 when API returns no entries", async () => {
		stubFetch({ ok: true, entries: [], total: 0 });

		const { entries, total, fetch } = useLogs({});
		await fetch();

		expect(entries.value).toStrictEqual([]);
		expect(total.value).toBe(0);
	});
});

describe("useLogs — loadMore (pagination)", () => {
	it("appends entries and keeps total when loadMore is called", async () => {
		const page1 = [makeEntry({ msg: "entry-1" }), makeEntry({ msg: "entry-2" })];
		const page2 = [makeEntry({ msg: "entry-3" })];

		stubFetch({ ok: true, entries: page1, total: 3 });
		const { entries, total, fetch, loadMore } = useLogs({ limit: 2 });
		await fetch();

		expect(entries.value).toHaveLength(2);
		expect(total.value).toBe(3);

		stubFetch({ ok: true, entries: page2, total: 3 });
		await loadMore();

		expect(entries.value).toHaveLength(3);
		expect(entries.value[2]?.msg).toBe("entry-3");
		expect(total.value).toBe(3);
	});

	it("sends offset equal to current entries length on loadMore", async () => {
		const page1 = [makeEntry({ msg: "a" }), makeEntry({ msg: "b" })];
		stubFetch({ ok: true, entries: page1, total: 5 });
		const { fetch, loadMore } = useLogs({ limit: 2 });
		await fetch();

		stubFetch({ ok: true, entries: [makeEntry({ msg: "c" })], total: 5 });
		await loadMore();

		const [url] = mockFetch.mock.calls[1] as [string];
		expect(url).toContain("offset=2");
	});

	it("loadMore is a no-op when all entries are already loaded", async () => {
		stubFetch({ ok: true, entries: [makeEntry(), makeEntry()], total: 2 });
		const { fetch, loadMore } = useLogs({});
		await fetch();

		await loadMore();

		// Only 1 fetch call (the initial fetch), no second call for loadMore
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("loadMore is a no-op when already loading", async () => {
		// Set up: entries < total so loadMore would normally fire
		const page1 = [makeEntry({ msg: "a" })];
		stubFetch({ ok: true, entries: page1, total: 5 });
		const { loading, fetch, loadMore } = useLogs({ limit: 1 });
		await fetch();

		// Simulate in-flight state
		loading.value = true;
		await loadMore();

		// Still only 1 call (the initial fetch)
		expect(mockFetch).toHaveBeenCalledOnce();

		// Clean up
		loading.value = false;
	});

	it("loadMore is a no-op when not authenticated", async () => {
		// Load some entries first
		stubFetch({ ok: true, entries: [makeEntry()], total: 5 });
		const { fetch, loadMore } = useLogs({ limit: 1 });
		await fetch();

		// Remove token mid-session
		localStorageMap.clear();
		setActivePinia(createPinia());

		await loadMore();

		// Only 1 fetch call (the initial one); loadMore returned early
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("preserves filters from last fetch() when loadMore is called", async () => {
		const page1 = [makeEntry({ msg: "e1" })];
		stubFetch({ ok: true, entries: page1, total: 3 });
		const { fetch, loadMore } = useLogs({ limit: 1 });
		await fetch({ level: "warn", search: "timeout" });

		stubFetch({ ok: true, entries: [makeEntry({ msg: "e2" })], total: 3 });
		await loadMore();

		const [url] = mockFetch.mock.calls[1] as [string];
		expect(url).toContain("level=warn");
		expect(url).toContain("search=timeout");
		expect(url).toContain("offset=1");
	});

	it("sets error on loadMore when response is not ok", async () => {
		stubFetch({ ok: true, entries: [makeEntry()], total: 5 });
		const { error, fetch, loadMore } = useLogs({ limit: 1 });
		await fetch();

		stubFetch({ ok: false, status: 502, statusText: "Bad Gateway" });
		await loadMore();

		expect(error.value).toBe("Request failed: 502 Bad Gateway");
	});
});
