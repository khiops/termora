import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, ref } from "vue";
import { useNotificationStore } from "../stores/notifications.js";
import { useScrollBehavior } from "./useScrollBehavior.js";

describe("useScrollBehavior", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("shows bar when tab becomes active with unread lines (auto mode)", async () => {
		const notificationStore = useNotificationStore();
		const isActive = ref(false);
		const channelId = ref<string | null>("ch1");

		const { showBar, barLineCount } = useScrollBehavior({
			channelId: computed(() => channelId.value),
			isActiveTab: computed(() => isActive.value),
			scrollMode: "auto",
			autoThreshold: 100,
		});

		// Simulate unread lines
		notificationStore.addUnreadLines("ch1", 10);

		// Switch to active
		isActive.value = true;
		await nextTick();

		expect(showBar.value).toBe(true);
		expect(barLineCount.value).toBe(10);
	});

	it("scrolls to bottom when lines exceed threshold (auto mode)", async () => {
		const notificationStore = useNotificationStore();
		const isActive = ref(false);
		const scrollFn = vi.fn();

		const { showBar } = useScrollBehavior({
			channelId: computed(() => "ch1"),
			isActiveTab: computed(() => isActive.value),
			scrollMode: "auto",
			autoThreshold: 100,
			scrollToBottom: scrollFn,
		});

		notificationStore.addUnreadLines("ch1", 200);

		isActive.value = true;
		await nextTick();

		expect(showBar.value).toBe(false);
		expect(scrollFn).toHaveBeenCalled();
	});

	it("always scrolls to bottom in alwaysBottom mode", async () => {
		const notificationStore = useNotificationStore();
		const isActive = ref(false);
		const scrollFn = vi.fn();

		const { showBar } = useScrollBehavior({
			channelId: computed(() => "ch1"),
			isActiveTab: computed(() => isActive.value),
			scrollMode: "alwaysBottom",
			scrollToBottom: scrollFn,
		});

		notificationStore.addUnreadLines("ch1", 5);

		isActive.value = true;
		await nextTick();

		expect(showBar.value).toBe(false);
		expect(scrollFn).toHaveBeenCalled();
	});

	it("shows bar in alwaysResume mode", async () => {
		const notificationStore = useNotificationStore();
		const isActive = ref(false);

		const { showBar } = useScrollBehavior({
			channelId: computed(() => "ch1"),
			isActiveTab: computed(() => isActive.value),
			scrollMode: "alwaysResume",
		});

		notificationStore.addUnreadLines("ch1", 5);

		isActive.value = true;
		await nextTick();

		expect(showBar.value).toBe(true);
	});

	it("markRead clears bar and notifications", async () => {
		const notificationStore = useNotificationStore();
		const isActive = ref(true);

		notificationStore.addUnreadLines("ch1", 10);
		notificationStore.setActivity("ch1");

		const { showBar, markRead } = useScrollBehavior({
			channelId: computed(() => "ch1"),
			isActiveTab: computed(() => isActive.value),
		});

		showBar.value = true;
		markRead();

		expect(showBar.value).toBe(false);
		expect(notificationStore.unreadLines.get("ch1")).toBeUndefined();
	});

	it("jumpToBottom clears bar and calls scroll function", () => {
		const scrollFn = vi.fn();

		const { showBar, jumpToBottom } = useScrollBehavior({
			channelId: computed(() => "ch1"),
			isActiveTab: computed(() => true),
			scrollToBottom: scrollFn,
		});

		showBar.value = true;
		jumpToBottom();

		expect(showBar.value).toBe(false);
		expect(scrollFn).toHaveBeenCalled();
	});

	it("onNaturalScrollToBottom clears bar", () => {
		const { showBar, onNaturalScrollToBottom } = useScrollBehavior({
			channelId: computed(() => "ch1"),
			isActiveTab: computed(() => true),
		});

		showBar.value = true;
		onNaturalScrollToBottom();

		expect(showBar.value).toBe(false);
	});
});
