import type { CascadeResponse } from "@nexterm/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNestedValue, useSettingsStore } from "./settings.js";

// Stub localStorage — useAuthStore reads from it
const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

// Stub fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeCascade(overrides?: Partial<CascadeResponse>): CascadeResponse {
	return {
		terminal: {
			defaults: {
				fontFamily: "monospace",
				fontSize: 14,
				cursorStyle: "block",
				scrollback: 1000,
				bellSound: true,
			},
			global: {
				fontFamily: "Consolas",
				fontSize: 16,
			},
			host: {
				fontSize: 18,
			},
			channel: {},
			resolved: {
				fontFamily: "Consolas",
				fontSize: 18,
				cursorStyle: "block",
				scrollback: 1000,
				bellSound: true,
			},
		},
		ui: {
			defaults: {
				onChannelDead: "readonly",
				tabs: {
					closeButton: true,
					newTabPosition: "end",
					confirmCloseAll: true,
					confirmCloseOthers: true,
				},
				panes: { maxPanes: 4, defaultSplitDirection: "horizontal" },
				channels: { defaultShell: "" },
				startup: { autoOpenWelcome: true },
				title: {
					source: "dynamic",
					fallback: "channel",
					maxLength: 50,
					truncation: "end",
					windowTitle: true,
					windowFormat: "nexterm - {prefix}{host} - {title}",
				},
				search: {
					position: "top-right",
					highlightOnClose: "clear",
					scrollbarMarkers: true,
					historySize: 20,
				},
			},
			global: {
				tabs: { closeButton: false },
			},
			resolved: {
				onChannelDead: "readonly",
				tabs: {
					closeButton: false,
					newTabPosition: "end",
					confirmCloseAll: true,
					confirmCloseOthers: true,
				},
				panes: { maxPanes: 4, defaultSplitDirection: "horizontal" },
				channels: { defaultShell: "" },
				startup: { autoOpenWelcome: true },
				title: {
					source: "dynamic",
					fallback: "channel",
					maxLength: 50,
					truncation: "end",
					windowTitle: true,
					windowFormat: "nexterm - {prefix}{host} - {title}",
				},
				search: {
					position: "top-right",
					highlightOnClose: "clear",
					scrollbarMarkers: true,
					historySize: 20,
				},
			},
		},
		appearance: {
			theme: "catppuccin-mocha",
			autoSwitch: { enabled: false, darkTheme: "catppuccin-mocha", lightTheme: "catppuccin-latte" },
			opacity: { terminal: 100, sidebar: 100, hostRail: 100, tabBar: 100 },
			scrollbar: { style: "thin", thumbColor: "", trackColor: "", widthThin: 6, widthWide: 14 },
		},
		...overrides,
	};
}

describe("getNestedValue", () => {
	it("returns top-level value", () => {
		expect(getNestedValue({ foo: 42 }, "foo")).toBe(42);
	});

	it("returns nested value via dot path", () => {
		expect(getNestedValue({ a: { b: { c: "deep" } } }, "a.b.c")).toBe("deep");
	});

	it("returns undefined for missing path", () => {
		expect(getNestedValue({ a: 1 }, "b")).toBeUndefined();
	});

	it("returns undefined for null input", () => {
		expect(getNestedValue(null, "a")).toBeUndefined();
	});

	it("returns undefined when traversing through non-object", () => {
		expect(getNestedValue({ a: 42 }, "a.b")).toBeUndefined();
	});
});

describe("useSettingsStore", () => {
	beforeEach(() => {
		localStorageMap.clear();
		localStorageMap.set("nexterm_token", "test-token");
		setActivePinia(createPinia());
		mockFetch.mockReset();
	});

	describe("loadCascade", () => {
		it("fetches cascade from API and stores it", async () => {
			const data = makeCascade();
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(data),
			});

			const store = useSettingsStore();
			await store.loadCascade("host-1", "chan-1");

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/config/cascade?host_id=host-1&channel_id=chan-1",
				expect.objectContaining({
					headers: { Authorization: "Bearer test-token" },
				}),
			);
			expect(store.cascade).toEqual(data);
			expect(store.loading).toBe(false);
		});

		it("sets loading to false even on error", async () => {
			mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

			const store = useSettingsStore();
			// Token is set in beforeEach, so fetch will be called and error will propagate
			await expect(store.loadCascade()).rejects.toThrow("Failed to load cascade: 500");
			expect(store.loading).toBe(false);
		});

		it("returns early without fetching when no auth token", async () => {
			localStorageMap.clear(); // remove token
			setActivePinia(createPinia()); // re-init so auth store reads empty localStorage

			const store = useSettingsStore();
			await store.loadCascade();

			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe("getValue", () => {
		it("returns global terminal value from cascade", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getValue("global", "terminal", "fontFamily")).toBe("Consolas");
		});

		it("returns host terminal override value", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getValue("host", "terminal", "fontSize")).toBe(18);
		});

		it("returns undefined for missing host override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getValue("host", "terminal", "fontFamily")).toBeUndefined();
		});

		it("returns appearance value", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getValue("global", "appearance", "theme")).toBe("catppuccin-mocha");
		});

		it("handles dot-path keys like tabs.closeButton", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getValue("global", "ui", "tabs.closeButton")).toBe(false);
		});

		it("returns undefined when cascade is null", () => {
			const store = useSettingsStore();
			expect(store.getValue("global", "terminal", "fontSize")).toBeUndefined();
		});

		it("returns undefined for channel scope with empty channel overrides", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getValue("channel", "terminal", "fontSize")).toBeUndefined();
		});
	});

	describe("isOverridden", () => {
		it("returns true for global scope always", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.isOverridden("global", "terminal", "fontFamily")).toBe(true);
		});

		it("returns true when host has an override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.isOverridden("host", "terminal", "fontSize")).toBe(true);
		});

		it("returns false when host has no override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.isOverridden("host", "terminal", "fontFamily")).toBe(false);
		});

		it("returns false when channel has no override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.isOverridden("channel", "terminal", "fontSize")).toBe(false);
		});
	});

	describe("inheritedFrom", () => {
		it("returns null for global scope", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.inheritedFrom("global", "terminal", "fontFamily")).toBeNull();
		});

		it("returns global value when host has no override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			const result = store.inheritedFrom("host", "terminal", "fontFamily");
			expect(result).toEqual({ value: "Consolas", source: "global" });
		});

		it("returns defaults when host has no override and global has no override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			const result = store.inheritedFrom("host", "terminal", "scrollback");
			expect(result).toEqual({ value: 1000, source: "defaults" });
		});

		it("returns host value when channel has no override but host does", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			const result = store.inheritedFrom("channel", "terminal", "fontSize");
			expect(result).toEqual({ value: 18, source: "host" });
		});

		it("returns global value when channel and host have no override", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			const result = store.inheritedFrom("channel", "terminal", "fontFamily");
			expect(result).toEqual({ value: "Consolas", source: "global" });
		});

		it("returns defaults when no override at any level for channel scope", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			const result = store.inheritedFrom("channel", "terminal", "scrollback");
			expect(result).toEqual({ value: 1000, source: "defaults" });
		});

		it("returns null for non-terminal sections", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.inheritedFrom("host", "appearance", "theme")).toBeNull();
		});

		it("returns null when cascade is null", () => {
			const store = useSettingsStore();
			expect(store.inheritedFrom("host", "terminal", "fontSize")).toBeNull();
		});
	});

	describe("getResolved", () => {
		it("returns resolved terminal value", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getResolved("terminal", "fontSize")).toBe(18);
		});

		it("returns resolved UI value via dot path", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getResolved("ui", "tabs.closeButton")).toBe(false);
		});

		it("returns resolved appearance value", () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();
			expect(store.getResolved("appearance", "theme")).toBe("catppuccin-mocha");
		});

		it("returns undefined when cascade is null", () => {
			const store = useSettingsStore();
			expect(store.getResolved("terminal", "fontSize")).toBeUndefined();
		});
	});

	describe("updateSetting", () => {
		it("applies optimistic update immediately", async () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();

			// Start the update (debounced, won't fire API immediately)
			void store.updateSetting("global", "terminal", "fontSize", 20);

			// Optimistic update should be immediate
			expect(store.getValue("global", "terminal", "fontSize")).toBe(20);
			expect(store.getResolved("terminal", "fontSize")).toBe(20);
		});
	});

	describe("resetSetting", () => {
		it("sends null value to remove override", async () => {
			const store = useSettingsStore();
			store.cascade = makeCascade();

			// resetSetting delegates to updateSetting with null
			void store.resetSetting("host", "terminal", "fontSize");

			// Optimistic: fontSize should be removed from host layer
			expect(store.getValue("host", "terminal", "fontSize")).toBeUndefined();
		});
	});
});
