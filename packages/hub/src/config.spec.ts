import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROFILE, deepMerge } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConfigResolver,
	DEFAULT_CHANNELS_CONFIG,
	DEFAULT_GC_CONFIG,
	DEFAULT_PANES_CONFIG,
	DEFAULT_STARTUP_CONFIG,
	DEFAULT_TABS_CONFIG,
	DEFAULT_UI_CONFIG,
	extractUiConfig,
	loadGcConfig,
	loadUiConfig,
} from "./config.js";
import { createServer } from "./server.js";
import { openTestDatabases } from "./storage/db.js";
import type { DatabaseManager } from "./storage/db.js";
import { MetaDAL } from "./storage/meta.js";

// ─── Mock agents so no real PTY / SSH is spawned ─────────────────────────────

vi.mock("./session/local-agent.js", () => {
	const { EventEmitter } = require("node:events");
	class MockLocalAgent extends EventEmitter {
		connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn();
		close = vi.fn(() => {
			this.connected = false;
			this.emit("close");
		});
	}
	return { LocalAgent: MockLocalAgent };
});

vi.mock("./session/ssh-agent.js", () => {
	const { EventEmitter } = require("node:events");
	class MockSshAgent extends EventEmitter {
		connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn();
		close = vi.fn(() => {
			this.connected = false;
			this.emit("close");
		});
	}
	return { SshAgent: MockSshAgent };
});

// ─── deepMerge unit tests ─────────────────────────────────────────────────────

describe("deepMerge", () => {
	it("scalar override: later value wins", () => {
		const result = deepMerge<Record<string, unknown>>({ a: 1 }, { a: 2 });
		expect(result).toEqual({ a: 2 });
	});

	it("nested object merge: keys merged recursively", () => {
		const result = deepMerge<Record<string, unknown>>(
			{ a: { x: 1, y: 2 } },
			{ a: { y: 99, z: 3 } },
		);
		expect(result).toEqual({ a: { x: 1, y: 99, z: 3 } });
	});

	it("null removes a key from base", () => {
		const result = deepMerge<Record<string, unknown>>({ a: 1, b: 2 }, { a: null });
		expect(result).not.toHaveProperty("a");
		expect(result.b).toBe(2);
	});

	it("arrays replace entirely (no element merge)", () => {
		const result = deepMerge<Record<string, unknown>>({ arr: [1, 2, 3] }, { arr: [4, 5] });
		expect(result.arr).toEqual([4, 5]);
	});

	it("empty override: base is returned unchanged", () => {
		const base: Record<string, unknown> = { fontFamily: "monospace", fontSize: 14 };
		const result = deepMerge<Record<string, unknown>>(base, {});
		expect(result).toEqual(base);
	});

	it("undefined sources are skipped", () => {
		const result = deepMerge<Record<string, unknown>>({ a: 1 }, undefined, { b: 2 });
		expect(result).toEqual({ a: 1, b: 2 });
	});

	it("null sources are skipped", () => {
		const result = deepMerge<Record<string, unknown>>({ a: 1 }, null, { b: 2 });
		expect(result).toEqual({ a: 1, b: 2 });
	});

	it("multiple layers: last wins for scalars", () => {
		const result = deepMerge<Record<string, unknown>>(
			{ fontSize: 12, fontFamily: "monospace" },
			{ fontSize: 13 },
			{ fontSize: 14 },
		);
		expect(result.fontSize).toBe(14);
		expect(result.fontFamily).toBe("monospace");
	});
});

// ─── ConfigResolver unit tests ────────────────────────────────────────────────

describe("ConfigResolver.resolve", () => {
	let dbs: DatabaseManager;
	let metaDal: MetaDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		metaDal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	it("no overrides → returns DEFAULT_PROFILE", () => {
		const resolver = new ConfigResolver(metaDal);
		const result = resolver.resolve();
		expect(result).toEqual(DEFAULT_PROFILE);
	});

	it("layer 2: config.toml overrides defaults", () => {
		const dir = join(tmpdir(), `nexterm-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "config.toml"),
			`[terminal]\nfont_size = 16\nfont_family = "JetBrains Mono"\n`,
		);

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		const result = resolver.resolve();

		expect(result.fontSize).toBe(16);
		expect(result.fontFamily).toBe("JetBrains Mono");
		// Unchanged defaults remain
		expect(result.scrollback).toBe(DEFAULT_PROFILE.scrollback);
		expect(result.cursorStyle).toBe(DEFAULT_PROFILE.cursorStyle);
	});

	it("layer 2: theme_overrides converted to themeOverrides", () => {
		const dir = join(tmpdir(), `nexterm-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "config.toml"),
			`[terminal]\n[terminal.theme_overrides]\nbackground = "#1a1b26"\n`,
		);

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		const result = resolver.resolve();

		expect(result.themeOverrides).toEqual({ background: "#1a1b26" });
	});

	it("layer 2: missing config.toml silently skipped", () => {
		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile("/nonexistent/path");
		expect(resolver.resolve()).toEqual(DEFAULT_PROFILE);
	});

	it("layer 3: host profile_json overrides layer 2", () => {
		const dir = join(tmpdir(), `nexterm-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[terminal]\nfont_size = 16\n");

		const host = metaDal.createHost({ type: "local", label: "test-host" });
		metaDal.updateHostProfile(host.id, JSON.stringify({ fontSize: 20, scrollback: 9999 }));

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		const result = resolver.resolve(host.id);

		expect(result.fontSize).toBe(20); // host overrides toml layer 2
		expect(result.scrollback).toBe(9999);
		expect(result.fontFamily).toBe('"Consolas", "Liberation Mono", "Courier New", monospace'); // layer 1 default still present
	});

	it("layer 3.5: agent hints override host profile", () => {
		const host = metaDal.createHost({ type: "local", label: "test-host-hints" });
		metaDal.updateHostProfile(host.id, JSON.stringify({ fontSize: 20 }));

		const resolver = new ConfigResolver(metaDal);
		resolver.setAgentHints("session-1", { fontSize: 18, theme: "dark" });
		const result = resolver.resolve(host.id, undefined, "session-1");

		expect(result.fontSize).toBe(18); // agent hints override host profile
		expect(result.theme).toBe("dark");
	});

	it("layer 4: channel profile_json overrides all lower layers", () => {
		const host = metaDal.createHost({ type: "local", label: "test-host-ch" });
		metaDal.updateHostProfile(host.id, JSON.stringify({ fontSize: 20 }));

		metaDal.createSession({ id: "ses-01", hostId: host.id, status: "starting" });
		metaDal.createChannel({ id: "ch-01", sessionId: "ses-01", status: "born" });
		metaDal.updateChannelProfile("ch-01", JSON.stringify({ fontSize: 24, bellSound: true }));

		const resolver = new ConfigResolver(metaDal);
		const result = resolver.resolve(host.id, "ch-01");

		expect(result.fontSize).toBe(24); // channel wins
		expect(result.bellSound).toBe(true);
	});

	it("full cascade order: layer 4 is final winner", () => {
		const dir = join(tmpdir(), `nexterm-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[terminal]\nfont_size = 13\n");

		const host = metaDal.createHost({ type: "local", label: "test-cascade" });
		metaDal.updateHostProfile(host.id, JSON.stringify({ fontSize: 15 }));

		metaDal.createSession({ id: "ses-cascade", hostId: host.id, status: "starting" });
		metaDal.createChannel({ id: "ch-cascade", sessionId: "ses-cascade", status: "born" });
		metaDal.updateChannelProfile("ch-cascade", JSON.stringify({ fontSize: 17 }));

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		resolver.setAgentHints("ses-cascade", { fontSize: 16 });
		const result = resolver.resolve(host.id, "ch-cascade", "ses-cascade");

		// Layer 4 (channel=17) beats layer 3.5 (agent=16) beats layer 3 (host=15)
		// beats layer 2 (toml=13) beats layer 1 (default=14)
		expect(result.fontSize).toBe(17);
	});

	it("clearAgentHints removes hints for session", () => {
		const resolver = new ConfigResolver(metaDal);
		resolver.setAgentHints("ses-x", { fontSize: 99 });
		resolver.clearAgentHints("ses-x");
		const result = resolver.resolve(undefined, undefined, "ses-x");
		expect(result.fontSize).toBe(DEFAULT_PROFILE.fontSize);
	});
});

// ─── loadGcConfig + ConfigResolver.gcConfig ──────────────────────────────────

describe("loadGcConfig", () => {
	it("returns defaults when config.toml does not exist", () => {
		const config = loadGcConfig("/nonexistent/path");
		expect(config).toEqual(DEFAULT_GC_CONFIG);
	});

	it("returns defaults when config.toml has no [gc] section", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[terminal]\nfont_size = 16\n");

		const config = loadGcConfig(dir);
		expect(config).toEqual(DEFAULT_GC_CONFIG);
	});

	it("parses dead_retention_hours from [gc] section", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[gc]\ndead_retention_hours = 48\n");

		const config = loadGcConfig(dir);
		expect(config.deadRetentionHours).toBe(48);
		expect(config.maxSizePerChannelMb).toBe(DEFAULT_GC_CONFIG.maxSizePerChannelMb);
	});

	it("parses max_size_per_channel_mb from [gc] section", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[gc]\nmax_size_per_channel_mb = 50\n");

		const config = loadGcConfig(dir);
		expect(config.maxSizePerChannelMb).toBe(50);
		expect(config.deadRetentionHours).toBe(DEFAULT_GC_CONFIG.deadRetentionHours);
	});

	it("parses both gc keys together", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "config.toml"),
			"[gc]\ndead_retention_hours = 0\nmax_size_per_channel_mb = 100\n",
		);

		const config = loadGcConfig(dir);
		expect(config.deadRetentionHours).toBe(0);
		expect(config.maxSizePerChannelMb).toBe(100);
	});

	it("ignores non-number values in [gc] section", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), '[gc]\ndead_retention_hours = "not-a-number"\n');

		const config = loadGcConfig(dir);
		expect(config.deadRetentionHours).toBe(DEFAULT_GC_CONFIG.deadRetentionHours);
	});

	it("returns defaults for malformed TOML", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[gc\nbroken");

		const config = loadGcConfig(dir);
		expect(config).toEqual(DEFAULT_GC_CONFIG);
	});
});

describe("ConfigResolver.gcConfig", () => {
	let dbs: DatabaseManager;
	let metaDal: MetaDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		metaDal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	it("returns defaults when no config.toml loaded", () => {
		const resolver = new ConfigResolver(metaDal);
		expect(resolver.gcConfig).toEqual(DEFAULT_GC_CONFIG);
	});

	it("returns overridden values after loadFromFile with [gc] section", () => {
		const dir = join(tmpdir(), `nexterm-gc-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "config.toml"),
			"[gc]\ndead_retention_hours = 72\nmax_size_per_channel_mb = 25\n",
		);

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		expect(resolver.gcConfig.deadRetentionHours).toBe(72);
		expect(resolver.gcConfig.maxSizePerChannelMb).toBe(25);
	});
});

// ─── REST endpoint integration tests ─────────────────────────────────────────

describe("GET /api/config/defaults", () => {
	let server: FastifyInstance;
	let dbs: DatabaseManager;

	beforeEach(async () => {
		dbs = openTestDatabases();
		server = await createServer({ logger: false, dbManager: dbs });
	});

	afterEach(async () => {
		await server.close();
		dbs.close();
	});

	it("returns DEFAULT_PROFILE", async () => {
		const res = await server.inject({ method: "GET", url: "/api/config/defaults" });
		expect(res.statusCode).toBe(200);
		const body = res.json<typeof DEFAULT_PROFILE>();
		expect(body.fontFamily).toBe(DEFAULT_PROFILE.fontFamily);
		expect(body.fontSize).toBe(DEFAULT_PROFILE.fontSize);
		expect(body.scrollback).toBe(DEFAULT_PROFILE.scrollback);
	});
});

describe("GET /api/config/resolved", () => {
	let server: FastifyInstance;
	let dbs: DatabaseManager;

	beforeEach(async () => {
		dbs = openTestDatabases();
		// Use tmpdir as configDir to avoid loading the real ~/.config/nexterm/config.toml
		server = await createServer({ logger: false, dbManager: dbs, configDir: tmpdir() });
	});

	afterEach(async () => {
		await server.close();
		dbs.close();
	});

	it("no params → returns defaults", async () => {
		const res = await server.inject({ method: "GET", url: "/api/config/resolved" });
		expect(res.statusCode).toBe(200);
		const body = res.json<typeof DEFAULT_PROFILE>();
		expect(body).toMatchObject(DEFAULT_PROFILE);
	});

	it("with host_id → merges host profile", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "test-resolved-host" },
		});
		expect(createRes.statusCode).toBe(201);
		const { id } = createRes.json<{ id: string }>();

		const patchRes = await server.inject({
			method: "PATCH",
			url: `/api/hosts/${id}/profile`,
			payload: { profile: { fontSize: 22 } },
		});
		expect(patchRes.statusCode).toBe(200);

		const res = await server.inject({
			method: "GET",
			url: `/api/config/resolved?host_id=${id}`,
		});
		expect(res.statusCode).toBe(200);
		const profile = res.json<{ fontSize: number }>();
		expect(profile.fontSize).toBe(22);
	});
});

describe("PATCH /api/hosts/:id/profile", () => {
	let server: FastifyInstance;
	let dbs: DatabaseManager;

	beforeEach(async () => {
		dbs = openTestDatabases();
		server = await createServer({ logger: false, dbManager: dbs });
	});

	afterEach(async () => {
		await server.close();
		dbs.close();
	});

	it("returns 404 for unknown host", async () => {
		const res = await server.inject({
			method: "PATCH",
			url: "/api/hosts/nonexistent/profile",
			payload: { profile: { fontSize: 14 } },
		});
		expect(res.statusCode).toBe(404);
	});

	it("updates host profile and returns ok", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "host-profile-test" },
		});
		const { id } = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PATCH",
			url: `/api/hosts/${id}/profile`,
			payload: { profile: { fontSize: 18, cursorStyle: "bar" } },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ ok: true });

		const resolved = await server.inject({
			method: "GET",
			url: `/api/config/resolved?host_id=${id}`,
		});
		const profile = resolved.json<{ fontSize: number; cursorStyle: string }>();
		expect(profile.fontSize).toBe(18);
		expect(profile.cursorStyle).toBe("bar");
	});

	it("returns 400 when profile field is missing from body", async () => {
		const createRes = await server.inject({
			method: "POST",
			url: "/api/hosts",
			payload: { type: "local", label: "host-profile-bad" },
		});
		const { id } = createRes.json<{ id: string }>();

		const res = await server.inject({
			method: "PATCH",
			url: `/api/hosts/${id}/profile`,
			payload: {},
		});
		expect(res.statusCode).toBe(400);
	});
});

describe("PATCH /api/channels/:id/profile", () => {
	let server: FastifyInstance;
	let dbs: DatabaseManager;

	beforeEach(async () => {
		dbs = openTestDatabases();
		server = await createServer({ logger: false, dbManager: dbs });
	});

	afterEach(async () => {
		await server.close();
		dbs.close();
	});

	it("returns 404 for unknown channel", async () => {
		const res = await server.inject({
			method: "PATCH",
			url: "/api/channels/nonexistent/profile",
			payload: { profile: { fontSize: 14 } },
		});
		expect(res.statusCode).toBe(404);
	});
});

// ─── extractUiConfig unit tests ──────────────────────────────────────────────

describe("extractUiConfig", () => {
	it("returns defaults when no [ui] section", () => {
		const config = extractUiConfig({});
		expect(config).toEqual(DEFAULT_UI_CONFIG);
	});

	it('parses on_channel_dead = "close"', () => {
		const config = extractUiConfig({ ui: { on_channel_dead: "close" } });
		expect(config.onChannelDead).toBe("close");
	});

	it('parses on_channel_dead = "readonly"', () => {
		const config = extractUiConfig({ ui: { on_channel_dead: "readonly" } });
		expect(config.onChannelDead).toBe("readonly");
	});

	it("falls back to default for invalid on_channel_dead value", () => {
		const config = extractUiConfig({ ui: { on_channel_dead: "invalid" } });
		expect(config.onChannelDead).toBe(DEFAULT_UI_CONFIG.onChannelDead);
	});
});

// ─── loadUiConfig ────────────────────────────────────────────────────────────

describe("loadUiConfig", () => {
	it("returns defaults when config.toml does not exist", () => {
		const config = loadUiConfig("/nonexistent/path");
		expect(config).toEqual(DEFAULT_UI_CONFIG);
	});

	it("returns defaults when config.toml has no [ui] section", () => {
		const dir = join(tmpdir(), `nexterm-ui-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[terminal]\nfont_size = 16\n");

		const config = loadUiConfig(dir);
		expect(config).toEqual(DEFAULT_UI_CONFIG);
	});

	it('parses on_channel_dead = "readonly" from [ui] section', () => {
		const dir = join(tmpdir(), `nexterm-ui-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), '[ui]\non_channel_dead = "readonly"\n');

		const config = loadUiConfig(dir);
		expect(config.onChannelDead).toBe("readonly");
	});

	it("returns defaults for malformed TOML", () => {
		const dir = join(tmpdir(), `nexterm-ui-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), "[ui\nbroken");

		const config = loadUiConfig(dir);
		expect(config).toEqual(DEFAULT_UI_CONFIG);
	});
});

// ─── ConfigResolver.uiConfig ────────────────────────────────────────────────

describe("ConfigResolver.uiConfig", () => {
	let dbs: DatabaseManager;
	let metaDal: MetaDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		metaDal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	it("returns defaults when no config.toml loaded", () => {
		const resolver = new ConfigResolver(metaDal);
		expect(resolver.uiConfig).toEqual(DEFAULT_UI_CONFIG);
	});

	it("returns overridden values after loadFromFile with [ui] section", () => {
		const dir = join(tmpdir(), `nexterm-ui-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.toml"), '[ui]\non_channel_dead = "readonly"\n');

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		expect(resolver.uiConfig.onChannelDead).toBe("readonly");
	});
});

// ─── GET /api/config/ui integration test ─────────────────────────────────────

describe("GET /api/config/ui", () => {
	let server: FastifyInstance;
	let dbs: DatabaseManager;

	beforeEach(async () => {
		dbs = openTestDatabases();
		server = await createServer({ logger: false, dbManager: dbs, configDir: tmpdir() });
	});

	afterEach(async () => {
		await server.close();
		dbs.close();
	});

	it("returns default UiConfig with tabs/panes/channels/startup", async () => {
		const res = await server.inject({ method: "GET", url: "/api/config/ui" });
		expect(res.statusCode).toBe(200);
		const body = res.json<typeof DEFAULT_UI_CONFIG>();
		expect(body.onChannelDead).toBe("readonly");
		expect(body.tabs).toEqual(DEFAULT_TABS_CONFIG);
		expect(body.panes).toEqual(DEFAULT_PANES_CONFIG);
		expect(body.channels).toEqual(DEFAULT_CHANNELS_CONFIG);
		expect(body.startup).toEqual(DEFAULT_STARTUP_CONFIG);
	});
});

// ─── extractUiConfig: tabs/panes/channels/startup ───────────────────────────

describe("extractUiConfig — tabs section", () => {
	it("returns default tabs config when no [tabs] section", () => {
		const config = extractUiConfig({});
		expect(config.tabs).toEqual(DEFAULT_TABS_CONFIG);
	});

	it("parses confirm_close_all = false", () => {
		const config = extractUiConfig({ tabs: { confirm_close_all: false } });
		expect(config.tabs.confirmCloseAll).toBe(false);
	});

	it("parses confirm_close_others = false", () => {
		const config = extractUiConfig({ tabs: { confirm_close_others: false } });
		expect(config.tabs.confirmCloseOthers).toBe(false);
	});

	it("parses close_button = false", () => {
		const config = extractUiConfig({ tabs: { close_button: false } });
		expect(config.tabs.closeButton).toBe(false);
	});

	it('parses new_tab_position = "afterActive"', () => {
		const config = extractUiConfig({ tabs: { new_tab_position: "afterActive" } });
		expect(config.tabs.newTabPosition).toBe("afterActive");
	});

	it("ignores invalid new_tab_position value", () => {
		const config = extractUiConfig({ tabs: { new_tab_position: "invalid" } });
		expect(config.tabs.newTabPosition).toBe(DEFAULT_TABS_CONFIG.newTabPosition);
	});
});

describe("extractUiConfig — panes section", () => {
	it("returns default panes config when no [panes] section", () => {
		const config = extractUiConfig({});
		expect(config.panes).toEqual(DEFAULT_PANES_CONFIG);
	});

	it("parses max_panes", () => {
		const config = extractUiConfig({ panes: { max_panes: 6 } });
		expect(config.panes.maxPanes).toBe(6);
	});

	it("ignores max_panes < 1", () => {
		const config = extractUiConfig({ panes: { max_panes: 0 } });
		expect(config.panes.maxPanes).toBe(DEFAULT_PANES_CONFIG.maxPanes);
	});

	it('parses default_split_direction = "vertical"', () => {
		const config = extractUiConfig({ panes: { default_split_direction: "vertical" } });
		expect(config.panes.defaultSplitDirection).toBe("vertical");
	});
});

describe("extractUiConfig — channels section", () => {
	it("returns default channels config when no [channels] section", () => {
		const config = extractUiConfig({});
		expect(config.channels).toEqual(DEFAULT_CHANNELS_CONFIG);
	});

	it("parses default_shell", () => {
		const config = extractUiConfig({ channels: { default_shell: "/bin/zsh" } });
		expect(config.channels.defaultShell).toBe("/bin/zsh");
	});
});

describe("extractUiConfig — startup section", () => {
	it("returns default startup config when no [startup] section", () => {
		const config = extractUiConfig({});
		expect(config.startup).toEqual(DEFAULT_STARTUP_CONFIG);
	});

	it("parses auto_open_welcome = false", () => {
		const config = extractUiConfig({ startup: { auto_open_welcome: false } });
		expect(config.startup.autoOpenWelcome).toBe(false);
	});
});

describe("ConfigResolver.uiConfig — tabs/panes", () => {
	let dbs: DatabaseManager;
	let metaDal: MetaDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		metaDal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	it("returns default tabs config when no config.toml loaded", () => {
		const resolver = new ConfigResolver(metaDal);
		expect(resolver.uiConfig.tabs).toEqual(DEFAULT_TABS_CONFIG);
	});

	it("returns overridden tabs values after loadFromFile", () => {
		const dir = join(tmpdir(), `nexterm-tabs-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "config.toml"),
			'[tabs]\nconfirm_close_all = false\nnew_tab_position = "afterActive"\n',
		);

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		expect(resolver.uiConfig.tabs.confirmCloseAll).toBe(false);
		expect(resolver.uiConfig.tabs.newTabPosition).toBe("afterActive");
		// Unchanged defaults
		expect(resolver.uiConfig.tabs.confirmCloseOthers).toBe(true);
	});

	it("returns overridden panes values after loadFromFile", () => {
		const dir = join(tmpdir(), `nexterm-panes-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "config.toml"),
			'[panes]\nmax_panes = 8\ndefault_split_direction = "vertical"\n',
		);

		const resolver = new ConfigResolver(metaDal);
		resolver.loadFromFile(dir);
		expect(resolver.uiConfig.panes.maxPanes).toBe(8);
		expect(resolver.uiConfig.panes.defaultSplitDirection).toBe("vertical");
	});
});
