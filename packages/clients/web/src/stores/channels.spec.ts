import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelsStore } from './channels.js';
import { useConfigStore } from './config.js';
import { useSessionStore } from './session.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const localStorageMap = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

// fetch is called by fetchGroups — stub it to return a controllable response
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const COLLAPSED_KEY = 'termora:collapsed-groups';

function makeGroupRow(id: string, name = 'Group'): Record<string, unknown> {
	return {
		id,
		host_id: 'host-1',
		name,
		sort_order: 0,
		created_at: '2026-01-01T00:00:00Z',
	};
}

function stubGroups(rows: Record<string, unknown>[]): void {
	mockFetch.mockImplementation((url: string) => {
		const body = url.includes('/api/groups') ? rows : [];
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
	// Seed auth token so fetchGroups doesn't early-return (TOKEN_KEY = "termora_token")
	localStorageMap.set('termora_token', 'test-token');
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// toggleGroupCollapsed — persists to localStorage
// ---------------------------------------------------------------------------

describe('useChannelsStore — toggleGroupCollapsed', () => {
	it('persists collapsed=true for a group on first toggle', async () => {
		stubGroups([makeGroupRow('g1')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		store.toggleGroupCollapsed('g1');

		const map = readCollapsedMap();
		expect(map).not.toBeNull();
		expect(map?.g1).toBe(true);
	});

	it('persists collapsed=false on second toggle (expand)', async () => {
		stubGroups([makeGroupRow('g1')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		store.toggleGroupCollapsed('g1'); // collapse
		store.toggleGroupCollapsed('g1'); // expand

		const map = readCollapsedMap();
		expect(map?.g1).toBe(false);
	});

	it('restores collapsed state when fetchGroups is called', async () => {
		// Pre-seed localStorage with a collapsed group
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ g1: true }));

		stubGroups([makeGroupRow('g1'), makeGroupRow('g2')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		const g1 = store.groups.find((g) => g.id === 'g1');
		const g2 = store.groups.find((g) => g.id === 'g2');
		expect(g1?.collapsed).toBe(true);
		expect(g2?.collapsed).toBe(false);
	});

	it('does not affect __general__ entry when toggling a real group', async () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ __general__: true }));
		stubGroups([makeGroupRow('g1')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		store.toggleGroupCollapsed('g1');

		const map = readCollapsedMap();
		// __general__ must survive the group toggle unchanged
		expect(map?.__general__).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// toggleGeneralCollapsed — persists to localStorage under __general__
// ---------------------------------------------------------------------------

describe('useChannelsStore — toggleGeneralCollapsed', () => {
	it('starts false by default', () => {
		const store = useChannelsStore();
		expect(store.generalCollapsed).toBe(false);
	});

	it('toggles generalCollapsed to true on first call', () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();
		expect(store.generalCollapsed).toBe(true);
	});

	it('toggles back to false on second call', () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();
		store.toggleGeneralCollapsed();
		expect(store.generalCollapsed).toBe(false);
	});

	it('writes __general__=true to localStorage on collapse', () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();

		const map = readCollapsedMap();
		expect(map).not.toBeNull();
		expect(map?.__general__).toBe(true);
	});

	it('writes __general__=false to localStorage on expand', () => {
		const store = useChannelsStore();
		store.toggleGeneralCollapsed(); // collapse
		store.toggleGeneralCollapsed(); // expand

		const map = readCollapsedMap();
		expect(map?.__general__).toBe(false);
	});

	it('does not overwrite other group entries in localStorage', () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ g1: true, g2: false }));
		const store = useChannelsStore();
		store.toggleGeneralCollapsed();

		const map = readCollapsedMap();
		expect(map?.g1).toBe(true);
		expect(map?.g2).toBe(false);
		expect(map?.__general__).toBe(true);
	});

	it('restores generalCollapsed=true from localStorage after fetchGroups', async () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ __general__: true }));
		stubGroups([]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');
		expect(store.generalCollapsed).toBe(true);
	});

	it('restores generalCollapsed=false when __general__ is absent from localStorage', async () => {
		localStorageMap.set(COLLAPSED_KEY, JSON.stringify({ g1: true }));
		stubGroups([]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');
		expect(store.generalCollapsed).toBe(false);
	});

	it('handles corrupt localStorage gracefully — defaults to false', async () => {
		localStorageMap.set(COLLAPSED_KEY, 'not-valid-json{{{');
		stubGroups([]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');
		expect(store.generalCollapsed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// fetchChannels — stale state cleared on startup (STATE_SYNC race fix)
// ---------------------------------------------------------------------------

describe('useChannelsStore — fetchChannels clears stale state', () => {
	function makeChannelRow(id: string, status: 'live' | 'dead' | 'connecting' = 'live'): Record<string, unknown> {
		return {
			id,
			session_id: 'sess-1',
			shell: '/bin/bash',
			cols: 80,
			rows: 24,
			status,
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
		};
	}

	function stubChannelsAndGroups(channels: Record<string, unknown>[], groups: Record<string, unknown>[] = []): void {
		mockFetch.mockImplementation((url: string) => {
			const body = url.includes('/api/groups') ? groups : channels;
			return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
		});
	}

	it('clears channels at the start of fetchChannels so STATE_SYNC always buffers', async () => {
		// Simulate stale in-memory state from a previous session
		stubChannelsAndGroups([makeChannelRow('ch-1')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');
		expect(store.channels).toHaveLength(1);

		// Now simulate a second fetchChannels call (e.g., reconnect).
		// channels.value must be [] at the start of the new fetch so that
		// a concurrent STATE_SYNC is buffered (not applied directly).
		let capturedChannelsLength: number | null = null;
		const origFetch = mockFetch.getMockImplementation();
		mockFetch.mockImplementation(async (url: string) => {
			// Capture channels.value length at the first await point inside fetchChannels
			capturedChannelsLength = store.channels.length;
			return origFetch!(url);
		});

		await store.fetchChannels('host-1');

		// channels must have been [] when the REST call started
		expect(capturedChannelsLength).toBe(0);
		// And the result is still populated correctly
		expect(store.channels).toHaveLength(1);
	});

	it('applies STATE_SYNC status when it arrives before fetchChannels completes', async () => {
		// Controlled promise to pause the REST response mid-flight
		let resolveChannels!: (v: unknown) => void;
		const channelsPromise = new Promise((r) => {
			resolveChannels = r;
		});

		mockFetch.mockImplementation((url: string) => {
			if (url.includes('/api/groups')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
			}
			// Channels response is held until we release it
			return channelsPromise.then(() => ({
				ok: true,
				json: () => Promise.resolve([makeChannelRow('ch-1', 'live')]),
			}));
		});

		const store = useChannelsStore();
		const fetchPromise = store.fetchChannels('host-1');

		// STATE_SYNC arrives while channels.value is still [] (REST not yet complete)
		// hub says ch-1 is "dead"
		store.applyStateSync([{ channelId: 'ch-1', sessionId: 'sess-1', status: 'dead' }]);

		// Release the REST response
		resolveChannels(undefined);
		await fetchPromise;

		// STATE_SYNC's "dead" status must win over REST's "live" status
		expect(store.channels).toHaveLength(1);
		expect(store.channels[0]?.status).toBe('dead');
	});

	it('marks channels absent from STATE_SYNC as dead via lastSyncIds', async () => {
		let resolveChannels!: (v: unknown) => void;
		const channelsPromise = new Promise((r) => {
			resolveChannels = r;
		});

		mockFetch.mockImplementation((url: string) => {
			if (url.includes('/api/groups')) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
			}
			return channelsPromise.then(() => ({
				ok: true,
				json: () => Promise.resolve([makeChannelRow('ch-1', 'live'), makeChannelRow('ch-2', 'live')]),
			}));
		});

		const store = useChannelsStore();
		const fetchPromise = store.fetchChannels('host-1');

		// STATE_SYNC only knows about ch-1 — ch-2 has been lost by the hub
		store.applyStateSync([{ channelId: 'ch-1', sessionId: 'sess-1', status: 'live' }]);

		resolveChannels(undefined);
		await fetchPromise;

		expect(store.channels).toHaveLength(2);
		const ch1 = store.channels.find((c) => c.id === 'ch-1');
		const ch2 = store.channels.find((c) => c.id === 'ch-2');
		expect(ch1?.status).toBe('live');
		// ch-2 is absent from STATE_SYNC → must be marked dead
		expect(ch2?.status).toBe('dead');
	});

	it('applies STATE_SYNC status when it arrives after fetchChannels completes', async () => {
		stubChannelsAndGroups([makeChannelRow('ch-1', 'live')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		// STATE_SYNC arrives after fetchChannels — channels.value is populated
		// so applyStateSync applies directly
		store.applyStateSync([{ channelId: 'ch-1', sessionId: 'sess-1', status: 'dead' }]);

		expect(store.channels[0]?.status).toBe('dead');
	});

	it('does not carry stale channels into a new host fetch', async () => {
		stubChannelsAndGroups([makeChannelRow('ch-old', 'live')]);
		const store = useChannelsStore();
		await store.fetchChannels('host-1');
		expect(store.channels.map((c) => c.id)).toContain('ch-old');

		// Switch to a different host — ch-old must not appear
		stubChannelsAndGroups([makeChannelRow('ch-new', 'live')]);
		await store.fetchChannels('host-2');

		expect(store.channels.map((c) => c.id)).not.toContain('ch-old');
		expect(store.channels.map((c) => c.id)).toContain('ch-new');
	});
});

// ---------------------------------------------------------------------------
// spawnChannel — autoGroup behaviour
// ---------------------------------------------------------------------------

describe('useChannelsStore — spawnChannel autoGroup', () => {
	function makeGroupRowWithOrder(id: string, name: string, sortOrder: number): Record<string, unknown> {
		return {
			id,
			host_id: 'host-1',
			name,
			sort_order: sortOrder,
			created_at: '2026-01-01T00:00:00Z',
		};
	}

	function setupWsClient(sentMessages: unknown[]): {
		on: ReturnType<typeof vi.fn>;
		send: ReturnType<typeof vi.fn>;
	} {
		const listeners = new Map<string, ((msg: unknown) => void)[]>();
		const on = vi.fn((type: string, cb: (msg: unknown) => void) => {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type)?.push(cb);
			return () => {
				const arr = listeners.get(type) ?? [];
				const idx = arr.indexOf(cb);
				if (idx !== -1) arr.splice(idx, 1);
			};
		});
		const send = vi.fn((msg: unknown) => {
			sentMessages.push(msg);
			// Immediately fire SPAWN_OK so the promise resolves
			const cbs = listeners.get('SPAWN_OK') ?? [];
			for (const cb of cbs) cb({ type: 'SPAWN_OK', channelId: 'ch-new' });
		});
		return { on, send };
	}

	beforeEach(() => {
		localStorageMap.set('termora_token', 'test-token');
	});

	it('sends SPAWN without groupId when autoGroup is none', async () => {
		mockFetch.mockImplementation((url: string) => {
			const body = url.includes('/api/groups') ? [makeGroupRowWithOrder('g1', 'Alpha', 0)] : [];
			return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
		});

		const sentMessages: unknown[] = [];
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		const sessionStore = useSessionStore();
		const { on, send } = setupWsClient(sentMessages);
		// @ts-expect-error — overwrite reactive wsClient for test
		sessionStore.wsClient = { on, send };

		// configStore defaults autoGroup to undefined (falsy) — no assignment
		await store.spawnChannel('host-1');

		expect(send).toHaveBeenCalledOnce();
		const msg = sentMessages[0] as Record<string, unknown>;
		expect(msg.type).toBe('SPAWN');
		expect(msg.groupId).toBeUndefined();
	});

	it("sends SPAWN with first group's id when autoGroup is first", async () => {
		mockFetch.mockImplementation((url: string) => {
			const body = url.includes('/api/groups')
				? [makeGroupRowWithOrder('g2', 'Beta', 10), makeGroupRowWithOrder('g1', 'Alpha', 0)]
				: [];
			return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
		});

		const sentMessages: unknown[] = [];
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		const sessionStore = useSessionStore();
		const { on, send } = setupWsClient(sentMessages);
		// @ts-expect-error — overwrite reactive wsClient for test
		sessionStore.wsClient = { on, send };

		const configStore = useConfigStore();
		configStore.uiConfig = { ...configStore.uiConfig, channels: { autoGroup: 'first' } };

		await store.spawnChannel('host-1');

		expect(send).toHaveBeenCalledOnce();
		const msg = sentMessages[0] as Record<string, unknown>;
		expect(msg.type).toBe('SPAWN');
		// g1 has sortOrder 0 — it's first
		expect(msg.groupId).toBe('g1');
	});

	it('sends SPAWN without groupId when autoGroup is first but no groups exist', async () => {
		mockFetch.mockImplementation((url: string) => {
			const body = url.includes('/api/groups') ? [] : [];
			return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
		});

		const sentMessages: unknown[] = [];
		const store = useChannelsStore();
		await store.fetchChannels('host-1');

		const sessionStore = useSessionStore();
		const { on, send } = setupWsClient(sentMessages);
		// @ts-expect-error — overwrite reactive wsClient for test
		sessionStore.wsClient = { on, send };

		const configStore = useConfigStore();
		configStore.uiConfig = { ...configStore.uiConfig, channels: { autoGroup: 'first' } };

		await store.spawnChannel('host-1');

		expect(send).toHaveBeenCalledOnce();
		const msg = sentMessages[0] as Record<string, unknown>;
		expect(msg.type).toBe('SPAWN');
		expect(msg.groupId).toBeUndefined();
	});
});
