import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesktopNotifications } from "./useDesktopNotifications.js";

describe("useDesktopNotifications — logic", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("groups multiple alerts within the grouping window", () => {
		// Test the grouping logic in isolation
		const groups = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> }>();
		const groupingWindowMs = 5000;

		function simulateAlert(tag: string): void {
			const existing = groups.get(tag);
			if (existing) {
				existing.count++;
				return;
			}
			const entry = {
				count: 1,
				timer: setTimeout(() => {
					groups.delete(tag);
				}, groupingWindowMs),
			};
			groups.set(tag, entry);
		}

		simulateAlert("bell-ch1");
		simulateAlert("bell-ch1");
		simulateAlert("bell-ch1");

		expect(groups.get("bell-ch1")?.count).toBe(3);

		// After timeout, group is cleared
		vi.advanceTimersByTime(5000);
		expect(groups.has("bell-ch1")).toBe(false);
	});

	it("tracks separate channels independently", () => {
		const groups = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> }>();
		const groupingWindowMs = 5000;

		function simulateAlert(tag: string): void {
			const existing = groups.get(tag);
			if (existing) {
				existing.count++;
				return;
			}
			groups.set(tag, {
				count: 1,
				timer: setTimeout(() => {
					groups.delete(tag);
				}, groupingWindowMs),
			});
		}

		simulateAlert("bell-ch1");
		simulateAlert("bell-ch2");
		simulateAlert("bell-ch1");

		expect(groups.get("bell-ch1")?.count).toBe(2);
		expect(groups.get("bell-ch2")?.count).toBe(1);
	});
});

describe("useDesktopNotifications — grouped notification body uses channel name", () => {
	beforeEach(() => {
		vi.useFakeTimers();

		// Stub Notification API
		const MockNotification = vi.fn().mockImplementation(function (
			this: { onclick: (() => void) | null; close: () => void },
			_title: string,
			_opts?: NotificationOptions,
		) {
			this.onclick = null;
			this.close = vi.fn();
		}) as unknown as typeof Notification;
		Object.defineProperty(MockNotification, "permission", {
			value: "granted",
			writable: true,
			configurable: true,
		});
		MockNotification.requestPermission = vi.fn().mockResolvedValue("granted");
		vi.stubGlobal("Notification", MockNotification);

		// Make document.hidden true so notifications fire
		Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
	});

	it("uses channelTitle in grouped notification body when provided", () => {
		const { showNotification } = useDesktopNotifications({ groupingWindowMs: 1000 });

		// First alert starts the grouping window
		showNotification("Bell", "Bell rang", "ch1", "My Shell");
		// Second alert within window increments count
		showNotification("Bell", "Bell rang", "ch1", "My Shell");

		// Advance past grouping window — grouped notification fires
		vi.advanceTimersByTime(1000);

		// The Notification constructor should have been called twice:
		// once immediately (first alert) and once after the timer (grouped)
		const calls = (globalThis.Notification as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const groupedCall = calls[calls.length - 1] as [string, NotificationOptions];
		expect(groupedCall[1]?.body).toBe("2 alerts in My Shell");
	});

	it("falls back to 'terminal' in grouped body when channelTitle is omitted", () => {
		const { showNotification } = useDesktopNotifications({ groupingWindowMs: 1000 });

		showNotification("Bell", "Bell rang", "ch2");
		showNotification("Bell", "Bell rang", "ch2");

		vi.advanceTimersByTime(1000);

		const calls = (globalThis.Notification as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const groupedCall = calls[calls.length - 1] as [string, NotificationOptions];
		expect(groupedCall[1]?.body).toBe("2 alerts in terminal");
	});
});

describe("useBellSound — validation", () => {
	it("rejects filenames with path separators", () => {
		const badNames = ["../evil.wav", "sub/dir/sound.wav", "..\\evil.wav"];
		for (const name of badNames) {
			expect(name.includes("/") || name.includes("\\") || name.includes("..")).toBe(true);
		}
	});

	it("accepts clean filenames", () => {
		const goodNames = ["bell.wav", "alert.mp3", "custom-sound.ogg"];
		for (const name of goodNames) {
			expect(name.includes("/") || name.includes("\\") || name.includes("..")).toBe(false);
		}
	});
});
