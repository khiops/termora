import type { TerminalProfile } from "@termora/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, nextTick, ref } from "vue";
import {
	resetWindowEffectsPlatformInfoForTests,
	resolveWindowEffect,
	useWindowEffects,
	type WindowEffectsPlatformInfo,
	type WindowEffectsWindow,
} from "./useWindowEffects.js";

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

function deferred(): { promise: Promise<void>; reject: () => void; resolve: () => void } {
	let reject!: () => void;
	let resolve!: () => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = () => fail(new Error("deferred rejection"));
	});
	return { promise, reject, resolve };
}

describe("resolveWindowEffect", () => {
	it("resolves auto and per-OS native effects", () => {
		const win11: WindowEffectsPlatformInfo = { os: "windows", windowsBuild: 26_100 };
		const win10: WindowEffectsPlatformInfo = { os: "windows", windowsBuild: 19_045 };
		const macos: WindowEffectsPlatformInfo = { os: "macos", windowsBuild: null };
		const linux: WindowEffectsPlatformInfo = { os: "linux", windowsBuild: null };

		expect(
			resolveWindowEffect({ backgroundMode: "transparent", windowEffect: "auto" }, win11),
		).toBe("mica");
		expect(
			resolveWindowEffect({ backgroundMode: "transparent", windowEffect: "auto" }, win10),
		).toBe("blur");
		expect(
			resolveWindowEffect({ backgroundMode: "transparent", windowEffect: "auto" }, macos),
		).toBe("underWindowBackground");
		expect(
			resolveWindowEffect({ backgroundMode: "transparent", windowEffect: "auto" }, linux),
		).toBeNull();
	});

	it("degrades invalid combinations and unknown values to none", () => {
		const win10: WindowEffectsPlatformInfo = { os: "windows", windowsBuild: 19_045 };
		const win11: WindowEffectsPlatformInfo = { os: "windows", windowsBuild: 26_100 };

		expect(
			resolveWindowEffect({ backgroundMode: "transparent", windowEffect: "mica" }, win10),
		).toBeNull();
		expect(
			resolveWindowEffect({ backgroundMode: "solid", windowEffect: "auto" }, win11),
		).toBeNull();
		expect(
			resolveWindowEffect(
				{ backgroundMode: "transparent", windowEffect: "shimmer" } as unknown as TerminalProfile,
				win11,
			),
		).toBeNull();
		expect(
			resolveWindowEffect(
				{ backgroundMode: "garbage", windowEffect: "auto" } as unknown as TerminalProfile,
				win11,
			),
		).toBeNull();
	});
});

describe("useWindowEffects", () => {
	afterEach(() => {
		resetWindowEffectsPlatformInfoForTests();
		vi.restoreAllMocks();
	});

	it("does not apply or clear effects before the active scope resolves", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(false);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(async () => {
				calls.push("clear");
			}),
		};

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow: async () => win,
			}),
		);
		await flushAsync();

		expect(calls).toEqual([]);

		resolvedForActivePane.value = true;
		await flushAsync();

		expect(calls).toEqual(["set:mica"]);
		unmount();
	});

	it("does not apply a pending effect after the active scope becomes unresolved", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(async () => {
				calls.push("clear");
			}),
		};
		let resolveWindow!: (value: WindowEffectsWindow) => void;
		const pendingWindow = new Promise<WindowEffectsWindow | null>((resolve) => {
			resolveWindow = resolve;
		});
		let firstWindowLookup = true;
		const getWindow = vi.fn(() => {
			if (firstWindowLookup) {
				firstWindowLookup = false;
				return pendingWindow;
			}
			return Promise.resolve(win);
		});

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow,
			}),
		);
		await flushAsync();

		resolvedForActivePane.value = false;
		await flushAsync();
		resolveWindow(win);
		await flushAsync();

		expect(calls).toEqual([]);

		resolvedForActivePane.value = true;
		await flushAsync();

		expect(calls).toEqual(["set:mica"]);
		expect(getWindow).toHaveBeenCalledTimes(2);
		unmount();
	});

	it("re-applies the latest desired effect after a stale IPC mutates native state", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "mica" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const setDeferreds: ReturnType<typeof deferred>[] = [];
		const clearDeferreds: ReturnType<typeof deferred>[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(({ effects }) => {
				calls.push(`set:${effects[0]}`);
				const pending = deferred();
				setDeferreds.push(pending);
				return pending.promise;
			}),
			clearEffects: vi.fn(() => {
				calls.push("clear");
				const pending = deferred();
				clearDeferreds.push(pending);
				return pending.promise;
			}),
		};

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow: async () => win,
			}),
		);
		await flushAsync();
		expect(calls).toEqual(["set:mica"]);

		setDeferreds[0]?.resolve();
		await flushAsync();

		profile.value = { backgroundMode: "image", windowEffect: "none" };
		await flushAsync();
		expect(calls).toEqual(["set:mica", "clear"]);

		profile.value = { backgroundMode: "transparent", windowEffect: "mica" };
		await flushAsync();
		expect(calls).toEqual(["set:mica", "clear"]);

		clearDeferreds[0]?.resolve();
		await flushAsync();

		expect(calls).toEqual(["set:mica", "clear", "set:mica"]);
		setDeferreds[1]?.resolve();
		await flushAsync();
		unmount();
	});

	it("retries the same desired effect after the window handle becomes available", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "mica" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(async () => {
				calls.push("clear");
			}),
		};
		const getWindow = vi.fn(async () => (getWindow.mock.calls.length === 1 ? null : win));

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow,
			}),
		);
		await flushAsync();
		expect(calls).toEqual([]);

		profile.value = { backgroundMode: "transparent", windowEffect: "mica" };
		await flushAsync();

		expect(calls).toEqual(["set:mica"]);
		expect(getWindow).toHaveBeenCalledTimes(2);
		unmount();
	});

	it("retries clearing the same desired no-effect state after a clear failure", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "mica" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const clearDeferreds: ReturnType<typeof deferred>[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(() => {
				calls.push("clear");
				const pending = deferred();
				clearDeferreds.push(pending);
				return pending.promise;
			}),
		};

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow: async () => win,
			}),
		);
		await flushAsync();
		expect(calls).toEqual(["set:mica"]);

		profile.value = { backgroundMode: "image", windowEffect: "none" };
		await flushAsync();
		expect(calls).toEqual(["set:mica", "clear"]);

		clearDeferreds[0]?.reject();
		await flushAsync();

		profile.value = { backgroundMode: "image", windowEffect: "none" };
		await flushAsync();

		expect(calls).toEqual(["set:mica", "clear", "clear"]);
		clearDeferreds[1]?.resolve();
		await flushAsync();
		unmount();
	});

	it("does not call into Tauri for platform paths that never applied an effect", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "linux",
			windowsBuild: null,
		});
		const getWindow = vi.fn(async () => null);

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow,
			}),
		);
		await flushAsync();

		profile.value = { backgroundMode: "image", windowEffect: "none" };
		await flushAsync();

		expect(getWindow).not.toHaveBeenCalled();
		unmount();
	});

	// --- Proof tests for the no-active-scope clear bug fix ---

	it("clears an applied effect when hasActiveScope drops to false (pane closed)", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(async () => {
				calls.push("clear");
			}),
		};

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow: async () => win,
			}),
		);
		await flushAsync();
		expect(calls).toEqual(["set:mica"]);

		// Simulate closing the last pane / no active channel.
		resolvedForActivePane.value = false;
		hasActiveScope.value = false;
		await flushAsync();

		expect(calls).toEqual(["set:mica", "clear"]);
		unmount();
	});

	it("clears an applied effect when the unresolved-fallback fires (permanent-unresolved scope)", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(async () => {
				calls.push("clear");
			}),
		};

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow: async () => win,
			}),
		);
		await flushAsync();
		expect(calls).toEqual(["set:mica"]);

		// Simulate the unresolved-fallback timer firing: scope exists but profile never resolved.
		resolvedForActivePane.value = false;
		hasActiveScope.value = false; // fallbackActive=true → windowHasActiveScope=false
		await flushAsync();

		expect(calls).toEqual(["set:mica", "clear"]);
		unmount();
	});

	it("does not clear an applied effect during transient unresolved (anti-flicker: scope switches then resolves)", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(true);
		const hasActiveScope = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "windows",
			windowsBuild: 26_100,
		});
		const calls: string[] = [];
		const win: WindowEffectsWindow = {
			setEffects: vi.fn(async ({ effects }) => {
				calls.push(`set:${effects[0]}`);
			}),
			clearEffects: vi.fn(async () => {
				calls.push("clear");
			}),
		};

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
				hasActiveScope,
				platformInfo,
				getWindow: async () => win,
			}),
		);
		await flushAsync();
		expect(calls).toEqual(["set:mica"]);

		// Scope switches: unresolved but hasActiveScope stays true (transient).
		resolvedForActivePane.value = false;
		// hasActiveScope remains true — no clear should happen.
		await flushAsync();
		expect(calls).toEqual(["set:mica"]); // no clearEffects called

		// Profile resolves shortly after.
		resolvedForActivePane.value = true;
		await flushAsync();
		// Effect same as desired — no extra set/clear.
		expect(calls).toEqual(["set:mica"]);
		unmount();
	});
});
