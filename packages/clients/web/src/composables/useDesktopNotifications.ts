import { onUnmounted } from "vue";

interface GroupEntry {
	count: number;
	channelId: string;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Desktop notification management for terminal alerts.
 *
 * Features:
 * - Permission request wrapper
 * - Grouping: accumulates alerts within a window, shows "N alerts in <channel>"
 * - Click-to-focus: focuses window and activates the channel tab
 * - Only shows when document is hidden (tab not visible)
 */
export function useDesktopNotifications(opts?: {
	groupingWindowMs?: number;
	onActivateChannel?: (channelId: string) => void;
}) {
	const groupingWindowMs = opts?.groupingWindowMs ?? 5000;
	const pendingGroups = new Map<string, GroupEntry>();

	function requestPermission(): void {
		if (typeof Notification === "undefined") return;
		if (Notification.permission === "default") {
			void Notification.requestPermission();
		}
	}

	function showNotification(title: string, body: string, channelId: string, tag?: string): void {
		if (typeof Notification === "undefined") return;
		if (Notification.permission !== "granted") return;

		// Only show when document is hidden (user is not looking at this tab)
		if (!document.hidden) return;

		const effectiveTag = tag ?? `nexterm-bell-${channelId}`;
		const groupKey = effectiveTag;

		const existing = pendingGroups.get(groupKey);
		if (existing) {
			// Accumulate within grouping window
			existing.count++;
			// Update will happen when the timer fires
			return;
		}

		// Start a new grouping window
		const entry: GroupEntry = {
			count: 1,
			channelId,
			timer: setTimeout(() => {
				// Timer fired — show the grouped notification
				pendingGroups.delete(groupKey);
				_showNative(
					entry.count > 1 ? `${title} (${entry.count} alerts)` : title,
					entry.count > 1 ? `${entry.count} alerts in terminal` : body,
					channelId,
					effectiveTag,
				);
			}, groupingWindowMs),
		};
		pendingGroups.set(groupKey, entry);

		// Show the first notification immediately
		_showNative(title, body, channelId, effectiveTag);
	}

	function _showNative(title: string, body: string, channelId: string, tag: string): void {
		try {
			const notification = new Notification(title, {
				body,
				tag,
				silent: true, // Sound is handled separately by useBellSound
			});

			notification.onclick = () => {
				window.focus();
				opts?.onActivateChannel?.(channelId);
				notification.close();
			};
		} catch {
			// Notification API may throw in some environments (e.g. service workers)
		}
	}

	function dispose(): void {
		for (const entry of pendingGroups.values()) {
			clearTimeout(entry.timer);
		}
		pendingGroups.clear();
	}

	onUnmounted(dispose);

	return {
		requestPermission,
		showNotification,
		dispose,
	};
}
