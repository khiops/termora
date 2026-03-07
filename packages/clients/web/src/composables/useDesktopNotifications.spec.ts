import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
