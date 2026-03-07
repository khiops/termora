import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "./notifications.js";

describe("useNotificationStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	describe("incrementBellCount", () => {
		it("starts at 0 and increments", () => {
			const store = useNotificationStore();
			expect(store.bellCounts.get("ch1")).toBeUndefined();
			store.incrementBellCount("ch1");
			expect(store.bellCounts.get("ch1")).toBe(1);
			store.incrementBellCount("ch1");
			expect(store.bellCounts.get("ch1")).toBe(2);
		});

		it("tracks separate channels independently", () => {
			const store = useNotificationStore();
			store.incrementBellCount("ch1");
			store.incrementBellCount("ch2");
			store.incrementBellCount("ch1");
			expect(store.bellCounts.get("ch1")).toBe(2);
			expect(store.bellCounts.get("ch2")).toBe(1);
		});
	});

	describe("setActivity", () => {
		it("sets activity dot", () => {
			const store = useNotificationStore();
			expect(store.activityDots.get("ch1")).toBeUndefined();
			store.setActivity("ch1");
			expect(store.activityDots.get("ch1")).toBe(true);
		});

		it("is idempotent — does not replace map if already set", () => {
			const store = useNotificationStore();
			store.setActivity("ch1");
			const mapRef = store.activityDots;
			store.setActivity("ch1"); // same channel again
			// Should be same reference since no change was needed
			expect(store.activityDots).toBe(mapRef);
		});
	});

	describe("addUnreadLines", () => {
		it("accumulates line counts", () => {
			const store = useNotificationStore();
			store.addUnreadLines("ch1", 5);
			expect(store.unreadLines.get("ch1")).toBe(5);
			store.addUnreadLines("ch1", 3);
			expect(store.unreadLines.get("ch1")).toBe(8);
		});

		it("ignores zero and negative counts", () => {
			const store = useNotificationStore();
			store.addUnreadLines("ch1", 0);
			expect(store.unreadLines.get("ch1")).toBeUndefined();
			store.addUnreadLines("ch1", -1);
			expect(store.unreadLines.get("ch1")).toBeUndefined();
		});
	});

	describe("clearChannel", () => {
		it("clears all indicators for a channel", () => {
			const store = useNotificationStore();
			store.incrementBellCount("ch1");
			store.setActivity("ch1");
			store.addUnreadLines("ch1", 10);

			store.clearChannel("ch1");

			expect(store.bellCounts.get("ch1")).toBeUndefined();
			expect(store.activityDots.get("ch1")).toBeUndefined();
			expect(store.unreadLines.get("ch1")).toBeUndefined();
		});

		it("does not affect other channels", () => {
			const store = useNotificationStore();
			store.incrementBellCount("ch1");
			store.incrementBellCount("ch2");

			store.clearChannel("ch1");

			expect(store.bellCounts.get("ch1")).toBeUndefined();
			expect(store.bellCounts.get("ch2")).toBe(1);
		});
	});

	describe("clearAll", () => {
		it("clears everything", () => {
			const store = useNotificationStore();
			store.incrementBellCount("ch1");
			store.setActivity("ch2");
			store.addUnreadLines("ch3", 10);

			store.clearAll();

			expect(store.bellCounts.size).toBe(0);
			expect(store.activityDots.size).toBe(0);
			expect(store.unreadLines.size).toBe(0);
		});
	});

	describe("reactivity — map replacement", () => {
		it("produces new Map references on mutation", () => {
			const store = useNotificationStore();
			const before = store.bellCounts;
			store.incrementBellCount("ch1");
			expect(store.bellCounts).not.toBe(before);
		});
	});
});
