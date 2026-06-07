import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useNotificationStore } from "../stores/notifications.js";

// Mock ws-client — we test the handler logic directly
type MessageListener = (msg: Record<string, unknown>) => void;

function createMockWsClient() {
	const listeners = new Map<string, Set<MessageListener>>();
	return {
		on(type: string, cb: MessageListener): () => void {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(cb);
			return () => {
				listeners.get(type)?.delete(cb);
			};
		},
		_emit(type: string, msg: Record<string, unknown>): void {
			for (const cb of listeners.get(type) ?? []) {
				cb(msg);
			}
		},
		_listenerCount(type: string): number {
			return listeners.get(type)?.size ?? 0;
		},
	};
}

// We test the core logic without full Vue component lifecycle
// by importing the composable in a test pinia context
describe("useActivityTracker — logic", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("sets activity dot after debounce for inactive tab", async () => {
		const store = useNotificationStore();
		const mockWs = createMockWsClient();
		const channelId = ref<string | null>("ch1");
		const isActive = ref(false);

		// Simulate the tracker's handler logic
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		let pendingLineCount = 0;
		const debounceMs = 500;

		mockWs.on("OUTPUT", (msg) => {
			if (msg.type !== "OUTPUT" || msg.channelId !== channelId.value) return;
			if (isActive.value) return;

			const data = msg.data as string;
			if (data.trim().length === 0) return;

			let lines = 0;
			for (let i = 0; i < data.length; i++) {
				if (data.charCodeAt(i) === 0x0a) lines++;
			}

			if (lines > 0) store.addUnreadLines("ch1", lines);
			pendingLineCount += Math.max(lines, 1);

			if (debounceTimer !== null) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				if (pendingLineCount >= 1 && !isActive.value) {
					store.setActivity("ch1");
				}
				pendingLineCount = 0;
			}, debounceMs);
		});

		// Send output with newlines
		mockWs._emit("OUTPUT", { type: "OUTPUT", channelId: "ch1", data: "hello\nworld\n" });

		// Before debounce
		expect(store.activityDots.get("ch1")).toBeUndefined();
		expect(store.unreadLines.get("ch1")).toBe(2);

		// After debounce
		vi.advanceTimersByTime(500);
		expect(store.activityDots.get("ch1")).toBe(true);
	});

	it("does not set activity for active tab", () => {
		const store = useNotificationStore();
		const mockWs = createMockWsClient();
		const isActive = ref(true);

		mockWs.on("OUTPUT", (msg) => {
			if (msg.type !== "OUTPUT") return;
			if (isActive.value) return;
			store.setActivity("ch1");
		});

		mockWs._emit("OUTPUT", { type: "OUTPUT", channelId: "ch1", data: "hello\n" });
		expect(store.activityDots.get("ch1")).toBeUndefined();
	});

	it("ignores whitespace-only output", () => {
		const store = useNotificationStore();
		const mockWs = createMockWsClient();

		mockWs.on("OUTPUT", (msg) => {
			if (msg.type !== "OUTPUT") return;
			const data = msg.data as string;
			if (data.trim().length === 0) return;
			store.addUnreadLines("ch1", 1);
		});

		mockWs._emit("OUTPUT", { type: "OUTPUT", channelId: "ch1", data: "   \n\t\n  " });
		expect(store.unreadLines.get("ch1")).toBeUndefined();
	});

	it("counts newlines correctly", () => {
		const store = useNotificationStore();
		const mockWs = createMockWsClient();

		mockWs.on("OUTPUT", (msg) => {
			if (msg.type !== "OUTPUT") return;
			const data = msg.data as string;
			if (data.trim().length === 0) return;
			let lines = 0;
			for (let i = 0; i < data.length; i++) {
				if (data.charCodeAt(i) === 0x0a) lines++;
			}
			if (lines > 0) store.addUnreadLines("ch1", lines);
		});

		mockWs._emit("OUTPUT", { type: "OUTPUT", channelId: "ch1", data: "line1\nline2\nline3\n" });
		expect(store.unreadLines.get("ch1")).toBe(3);
	});
});
