import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelsStore } from "./channels.js";
import { useNotificationStore } from "./notifications.js";

// Stub localStorage — useChannelsStore → useAuthStore reads from it
const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
	clear: () => localStorageMap.clear(),
});

describe("useNotificationStore", () => {
	beforeEach(() => {
		localStorageMap.clear();
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

	describe("clearBellAndActivity", () => {
		it("clears bell and activity but keeps unreadLines", () => {
			const store = useNotificationStore();
			store.incrementBellCount("ch1");
			store.setActivity("ch1");
			store.addUnreadLines("ch1", 10);
			store.clearBellAndActivity("ch1");
			expect(store.bellCounts.get("ch1")).toBeUndefined();
			expect(store.activityDots.get("ch1")).toBeUndefined();
			expect(store.unreadLines.get("ch1")).toBe(10);
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

	describe("getBellCountForHost", () => {
		it("aggregates bells for channels mapped to a host", () => {
			const notifStore = useNotificationStore();
			const channelsStore = useChannelsStore();

			// Register channel→host mappings
			channelsStore.registerChannelHost("ch1", "host-A");
			channelsStore.registerChannelHost("ch2", "host-A");
			channelsStore.registerChannelHost("ch3", "host-B");

			notifStore.incrementBellCount("ch1");
			notifStore.incrementBellCount("ch1");
			notifStore.incrementBellCount("ch2");
			notifStore.incrementBellCount("ch3");

			expect(notifStore.getBellCountForHost("host-A")).toBe(3);
			expect(notifStore.getBellCountForHost("host-B")).toBe(1);
		});

		it("returns 0 for a host with no mapped channels", () => {
			const notifStore = useNotificationStore();
			notifStore.incrementBellCount("ch1");
			expect(notifStore.getBellCountForHost("unknown-host")).toBe(0);
		});

		it("returns 0 for a host whose channels have no bells", () => {
			const notifStore = useNotificationStore();
			const channelsStore = useChannelsStore();

			channelsStore.registerChannelHost("ch1", "host-A");
			// No incrementBellCount calls
			expect(notifStore.getBellCountForHost("host-A")).toBe(0);
		});

		it("ignores bells for unmapped channels", () => {
			const notifStore = useNotificationStore();
			const channelsStore = useChannelsStore();

			channelsStore.registerChannelHost("ch1", "host-A");
			notifStore.incrementBellCount("ch1");
			notifStore.incrementBellCount("ch-unmapped"); // no host mapping

			expect(notifStore.getBellCountForHost("host-A")).toBe(1);
		});
	});

	describe("getHostActivity", () => {
		it("returns true when any channel on that host has activity", () => {
			const notifStore = useNotificationStore();
			const channelsStore = useChannelsStore();

			channelsStore.registerChannelHost("ch1", "host-A");
			channelsStore.registerChannelHost("ch2", "host-B");

			notifStore.setActivity("ch1");

			expect(notifStore.getHostActivity("host-A")).toBe(true);
			expect(notifStore.getHostActivity("host-B")).toBe(false);
		});

		it("returns false for unknown hosts", () => {
			const notifStore = useNotificationStore();
			notifStore.setActivity("ch1");
			expect(notifStore.getHostActivity("unknown-host")).toBe(false);
		});
	});
});
