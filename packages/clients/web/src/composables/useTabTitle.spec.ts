import type { Channel } from "@nexterm/shared";
import { DEFAULT_CHANNEL_NAME } from "@nexterm/shared";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useTabTitle } from "./useTabTitle.js";

/** Helper to build a minimal Channel for testing. */
function makeChannel(overrides: Partial<Channel> & { id: string }): Channel {
	return {
		sessionId: "sess-1",
		shell: "/bin/bash",
		cols: 80,
		rows: 24,
		status: "live",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("useTabTitle", () => {
	// SC-05 (title stack) is covered implicitly by the priority chain tests below
	// (custom > live dynamic > stored dynamic > fallback).
	// SC-15 (ChannelItem sidebar rendering) requires Vue Test Utils component testing — TODO.

	// ── Priority: custom > dynamic > fallback ──────────────────────────

	it("returns DEFAULT_CHANNEL_NAME when channelId is null", () => {
		const channelId = ref<string | null>(null);
		const channels = ref<Channel[]>([]);
		const { tabTitle, isCustom, isDynamic } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
		expect(isCustom.value).toBe(false);
		expect(isDynamic.value).toBe(false);
	});

	it("returns DEFAULT_CHANNEL_NAME when channel has no title and no dynamicTitle", () => {
		const ch = makeChannel({ id: "ch-1" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle, isCustom, isDynamic } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
		expect(isCustom.value).toBe(false);
		expect(isDynamic.value).toBe(false);
	});

	it("returns dynamicTitle when no custom title is set", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "vim file.ts" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle, isCustom, isDynamic } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe("vim file.ts");
		expect(isCustom.value).toBe(false);
		expect(isDynamic.value).toBe(true);
	});

	it("custom title overrides dynamic title (SC-03)", () => {
		const ch = makeChannel({
			id: "ch-1",
			title: "My Server",
			dynamicTitle: "vim file.ts",
		});
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle, isCustom, isDynamic } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe("My Server");
		expect(isCustom.value).toBe(true);
		expect(isDynamic.value).toBe(false);
	});

	// ── Live dynamic title (from xterm.js onTitleChange) ───────────────

	it("prefers liveDynamicTitle over stored dynamicTitle", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "old title" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const live = ref<string | null>("nano README.md");

		const { tabTitle, isDynamic } = useTabTitle(channelId, channels, live);

		expect(tabTitle.value).toBe("nano README.md");
		expect(isDynamic.value).toBe(true);
	});

	it("falls back to stored dynamicTitle when liveDynamicTitle is null", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "stored title" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const live = ref<string | null>(null);

		const { tabTitle, isDynamic } = useTabTitle(channelId, channels, live);

		expect(tabTitle.value).toBe("stored title");
		expect(isDynamic.value).toBe(true);
	});

	it("custom title overrides liveDynamicTitle", () => {
		const ch = makeChannel({
			id: "ch-1",
			title: "Custom",
			dynamicTitle: "stored",
		});
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const live = ref<string | null>("live");

		const { tabTitle, isCustom, isDynamic } = useTabTitle(channelId, channels, live);

		expect(tabTitle.value).toBe("Custom");
		expect(isCustom.value).toBe(true);
		expect(isDynamic.value).toBe(false);
	});

	// ── Reactivity ─────────────────────────────────────────────────────

	it("updates when channel.dynamicTitle changes", () => {
		const ch = makeChannel({ id: "ch-1" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);

		// Simulate TITLE_CHANGE updating the store
		channels.value = [makeChannel({ id: "ch-1", dynamicTitle: "bash — ~/projects" })];
		expect(tabTitle.value).toBe("bash — ~/projects");
	});

	it("updates when channelId changes", () => {
		const ch1 = makeChannel({ id: "ch-1", dynamicTitle: "title-1" });
		const ch2 = makeChannel({ id: "ch-2", dynamicTitle: "title-2" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch1, ch2]);
		const { tabTitle } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe("title-1");

		channelId.value = "ch-2";
		expect(tabTitle.value).toBe("title-2");
	});

	// ── ATTACH_OK restore ──────────────────────────────────────────────

	it("title from ATTACH_OK restores on reconnect (dynamicTitle in store)", () => {
		// Simulates: ATTACH_OK sets channel.dynamicTitle → useTabTitle picks it up
		const ch = makeChannel({ id: "ch-1" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);

		// Simulate ATTACH_OK setting dynamicTitle
		channels.value = [makeChannel({ id: "ch-1", dynamicTitle: "restored title" })];
		expect(tabTitle.value).toBe("restored title");
	});

	// ── Edge cases ─────────────────────────────────────────────────────

	it("ignores empty string dynamicTitle", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle, isDynamic } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
		expect(isDynamic.value).toBe(false);
	});

	it("ignores empty string custom title", () => {
		const ch = makeChannel({ id: "ch-1", title: "", dynamicTitle: "fallback" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle, isCustom, isDynamic } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe("fallback");
		expect(isCustom.value).toBe(false);
		expect(isDynamic.value).toBe(true);
	});

	it("returns DEFAULT_CHANNEL_NAME when channel not found in list", () => {
		const channelId = ref<string | null>("missing");
		const channels = ref<Channel[]>([]);
		const { tabTitle } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
	});

	// ── Truncation ────────────────────────────────────────────────────

	it("truncates title exceeding maxLength", () => {
		const longTitle = "a".repeat(60);
		const ch = makeChannel({ id: "ch-1", dynamicTitle: longTitle });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle } = useTabTitle(channelId, channels, undefined, {
			maxLength: 20,
		});

		expect(tabTitle.value).toHaveLength(20);
		expect(tabTitle.value).toBe(`${"a".repeat(19)}\u2026`);
	});

	it("does not truncate short title", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "short" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle } = useTabTitle(channelId, channels, undefined, {
			maxLength: 20,
		});

		expect(tabTitle.value).toBe("short");
	});

	it("truncates using configured position", () => {
		const longTitle = "abcdefghijklmnopqrstuvwxyz";
		const ch = makeChannel({ id: "ch-1", dynamicTitle: longTitle });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle } = useTabTitle(channelId, channels, undefined, {
			maxLength: 10,
			truncationPosition: "start",
		});

		expect(tabTitle.value).toHaveLength(10);
		expect(tabTitle.value).toBe("\u2026rstuvwxyz");
	});

	// ── Prefix ────────────────────────────────────────────────────────

	it("prepends prefix to tab title", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "htop" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const prefix = ref("PROD ");
		const { tabTitle } = useTabTitle(channelId, channels, undefined, { prefix });

		expect(tabTitle.value).toBe("PROD htop");
	});

	it("prefix counts toward truncation limit", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "abcdefghij" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const prefix = ref("PROD ");
		const { tabTitle } = useTabTitle(channelId, channels, undefined, {
			prefix,
			maxLength: 10,
		});

		// "PROD abcdefghij" = 15 chars → truncated to 10
		expect(tabTitle.value).toHaveLength(10);
		expect(tabTitle.value).toBe("PROD abcd\u2026");
	});

	it("resolvedTitle does NOT include prefix", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "vim" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const prefix = ref("DEV ");
		const { tabTitle, resolvedTitle } = useTabTitle(channelId, channels, undefined, { prefix });

		expect(resolvedTitle.value).toBe("vim");
		expect(tabTitle.value).toBe("DEV vim");
	});

	it("no prefix option → tabTitle unchanged", () => {
		const ch = makeChannel({ id: "ch-1", dynamicTitle: "bash" });
		const channelId = ref<string | null>("ch-1");
		const channels = ref<Channel[]>([ch]);
		const { tabTitle, resolvedTitle } = useTabTitle(channelId, channels);

		expect(tabTitle.value).toBe("bash");
		expect(resolvedTitle.value).toBe("bash");
	});

	// ── TitleConfig settings ─────────────────────────────────────────

	describe("titleConfig integration", () => {
		it("source = 'static' ignores dynamic title", () => {
			const ch = makeChannel({ id: "ch-1", dynamicTitle: "vim file.ts" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle, isDynamic } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { source: "static" },
			});

			// With static source, dynamic title is ignored → fallback to channel name
			expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
			expect(isDynamic.value).toBe(false);
		});

		it("source = 'static' still honors custom title", () => {
			const ch = makeChannel({
				id: "ch-1",
				title: "My Server",
				dynamicTitle: "vim file.ts",
			});
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle, isCustom } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { source: "static" },
			});

			expect(tabTitle.value).toBe("My Server");
			expect(isCustom.value).toBe(true);
		});

		it("source = 'static' ignores liveDynamicTitle too", () => {
			const ch = makeChannel({ id: "ch-1" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const live = ref<string | null>("live process");
			const { tabTitle, isDynamic } = useTabTitle(channelId, channels, live, {
				titleConfig: { source: "static" },
			});

			expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
			expect(isDynamic.value).toBe(false);
		});

		it("source = 'dynamic' (default) shows dynamic title", () => {
			const ch = makeChannel({ id: "ch-1", dynamicTitle: "htop" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle, isDynamic } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { source: "dynamic" },
			});

			expect(tabTitle.value).toBe("htop");
			expect(isDynamic.value).toBe(true);
		});

		it("fallback = 'channel' shows DEFAULT_CHANNEL_NAME (default)", () => {
			const ch = makeChannel({ id: "ch-1" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { fallback: "channel" },
			});

			expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
		});

		it("fallback = 'shell' shows the shell program name", () => {
			const ch = makeChannel({ id: "ch-1", shell: "/usr/bin/zsh" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { fallback: "shell" },
			});

			expect(tabTitle.value).toBe("/usr/bin/zsh");
		});

		it("fallback = 'shell' falls back to DEFAULT_CHANNEL_NAME when shell is empty", () => {
			const ch = makeChannel({ id: "ch-1", shell: "" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { fallback: "shell" },
			});

			expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
		});

		it("fallback = 'custom' shows fallbackCustom string", () => {
			const ch = makeChannel({ id: "ch-1" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { fallback: "custom", fallbackCustom: "Session" },
			});

			expect(tabTitle.value).toBe("Session");
		});

		it("fallback = 'custom' without fallbackCustom falls back to DEFAULT_CHANNEL_NAME", () => {
			const ch = makeChannel({ id: "ch-1" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { fallback: "custom" },
			});

			expect(tabTitle.value).toBe(DEFAULT_CHANNEL_NAME);
		});

		it("titleConfig.maxLength overrides options.maxLength", () => {
			const longTitle = "a".repeat(40);
			const ch = makeChannel({ id: "ch-1", dynamicTitle: longTitle });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				maxLength: 50, // would allow full title
				titleConfig: { maxLength: 15 }, // overrides to shorter
			});

			expect(tabTitle.value).toHaveLength(15);
			expect(tabTitle.value).toBe(`${"a".repeat(14)}\u2026`);
		});

		it("titleConfig.truncation overrides options.truncationPosition", () => {
			const longTitle = "abcdefghijklmnopqrstuvwxyz";
			const ch = makeChannel({ id: "ch-1", dynamicTitle: longTitle });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				maxLength: 10,
				truncationPosition: "end", // would be overridden
				titleConfig: { truncation: "start" },
			});

			expect(tabTitle.value).toHaveLength(10);
			expect(tabTitle.value).toBe("\u2026rstuvwxyz");
		});

		it("dynamic title is still preferred over fallback when source = 'dynamic'", () => {
			const ch = makeChannel({
				id: "ch-1",
				dynamicTitle: "vim",
				shell: "/bin/bash",
			});
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { source: "dynamic", fallback: "shell" },
			});

			// Dynamic title takes precedence over fallback
			expect(tabTitle.value).toBe("vim");
		});

		it("fallback = 'shell' used when source = 'static' and no custom title", () => {
			const ch = makeChannel({ id: "ch-1", dynamicTitle: "vim", shell: "/bin/zsh" });
			const channelId = ref<string | null>("ch-1");
			const channels = ref<Channel[]>([ch]);
			const { tabTitle } = useTabTitle(channelId, channels, undefined, {
				titleConfig: { source: "static", fallback: "shell" },
			});

			// Static source ignores dynamic, falls back to shell
			expect(tabTitle.value).toBe("/bin/zsh");
		});
	});
});
