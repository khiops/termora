import { type ComputedRef, type Ref, onUnmounted, watch } from "vue";
import type { WsClient } from "../services/ws-client.js";
import { useNotificationStore } from "../stores/notifications.js";

/**
 * Track terminal activity for a channel.
 *
 * Listens to OUTPUT WS messages and:
 * - Sets an activity dot after debounce (only for inactive tabs)
 * - Counts newlines for unread line tracking
 *
 * Call in a component's setup() — cleans up automatically on unmount.
 */
export function useActivityTracker(opts: {
	channelId: ComputedRef<string | null>;
	isActiveTab: ComputedRef<boolean>;
	wsClient: WsClient;
	debounceMs?: number;
	minLines?: number;
}): { dispose: () => void } {
	const notificationStore = useNotificationStore();
	const debounceMs = opts.debounceMs ?? 500;
	const minLines = opts.minLines ?? 1;

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingLineCount = 0;
	let unsubWs: (() => void) | null = null;

	function countNewlines(data: Uint8Array | string): number {
		if (typeof data === "string") {
			let count = 0;
			for (let i = 0; i < data.length; i++) {
				if (data.charCodeAt(i) === 0x0a) count++;
			}
			return count;
		}
		// Uint8Array
		let count = 0;
		for (let i = 0; i < data.length; i++) {
			if (data[i] === 0x0a) count++;
		}
		return count;
	}

	function isWhitespaceOnly(data: Uint8Array | string): boolean {
		if (typeof data === "string") {
			return data.trim().length === 0;
		}
		for (let i = 0; i < data.length; i++) {
			const byte = data[i];
			// space, tab, newline, carriage return
			if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
				return false;
			}
		}
		return true;
	}

	function handleOutput(channelId: string, data: Uint8Array | string): void {
		// Skip whitespace-only output
		if (isWhitespaceOnly(data)) return;

		// Only track for inactive tabs
		if (opts.isActiveTab.value) return;

		const lines = countNewlines(data);

		// Add unread lines
		if (lines > 0) {
			notificationStore.addUnreadLines(channelId, lines);
		}

		// Debounced activity dot
		pendingLineCount += Math.max(lines, 1); // at least 1 for non-empty output

		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
		}

		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (pendingLineCount >= minLines && !opts.isActiveTab.value) {
				notificationStore.setActivity(channelId);
			}
			pendingLineCount = 0;
		}, debounceMs);
	}

	function subscribe(): void {
		unsubscribe();
		unsubWs = opts.wsClient.on("OUTPUT", (msg) => {
			if (msg.type !== "OUTPUT") return;
			const chId = opts.channelId.value;
			if (chId === null || msg.channelId !== chId) return;
			handleOutput(chId, msg.data);
		});
	}

	function unsubscribe(): void {
		if (unsubWs) {
			unsubWs();
			unsubWs = null;
		}
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		pendingLineCount = 0;
	}

	// Clear notifications when tab becomes active
	watch(opts.isActiveTab, (active) => {
		if (active) {
			const chId = opts.channelId.value;
			if (chId) {
				notificationStore.clearChannel(chId);
			}
			pendingLineCount = 0;
			if (debounceTimer !== null) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
		}
	});

	// Subscribe when channelId is available
	watch(
		opts.channelId,
		(newId) => {
			if (newId) {
				subscribe();
			} else {
				unsubscribe();
			}
		},
		{ immediate: true },
	);

	onUnmounted(() => {
		unsubscribe();
	});

	return { dispose: unsubscribe };
}
