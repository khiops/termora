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

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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

	it("re-applies the latest desired effect after a stale IPC mutates native state", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "mica" });
		const resolvedForActivePane = ref(true);
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
		expect(calls).toEqual(["set:mica", "clear", "set:mica"]);

		setDeferreds[1]?.resolve();
		await flushAsync();
		clearDeferreds[0]?.resolve();
		await flushAsync();

		expect(calls).toEqual(["set:mica", "clear", "set:mica", "set:mica"]);
		setDeferreds[2]?.resolve();
		await flushAsync();
		unmount();
	});

	it("does not call into Tauri for platform paths that never applied an effect", async () => {
		const profile = ref<TerminalProfile>({ backgroundMode: "transparent", windowEffect: "auto" });
		const resolvedForActivePane = ref(true);
		const platformInfo = ref<WindowEffectsPlatformInfo | null>({
			os: "linux",
			windowsBuild: null,
		});
		const getWindow = vi.fn(async () => null);

		const { unmount } = withSetup(() =>
			useWindowEffects({
				profile,
				resolvedForActivePane,
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
});
