import { defineStore } from "pinia";
import { shallowRef } from "vue";
import { useChannelsStore } from "./channels.js";

/**
 * Notification store — per-channel bell counts, activity dots, and unread line counts.
 *
 * Reactivity: Maps are replaced on each mutation (shallowRef pattern)
 * so Vue detects changes without deep watching.
 */
export const useNotificationStore = defineStore("notifications", () => {
	const bellCounts = shallowRef<Map<string, number>>(new Map());
	const activityDots = shallowRef<Map<string, boolean>>(new Map());
	const unreadLines = shallowRef<Map<string, number>>(new Map());

	// -------------------------------------------------------------------------
	// Per-channel mutations
	// -------------------------------------------------------------------------

	function incrementBellCount(channelId: string): void {
		const next = new Map(bellCounts.value);
		next.set(channelId, (next.get(channelId) ?? 0) + 1);
		bellCounts.value = next;
	}

	function setActivity(channelId: string): void {
		if (activityDots.value.get(channelId)) return; // already set
		const next = new Map(activityDots.value);
		next.set(channelId, true);
		activityDots.value = next;
	}

	function addUnreadLines(channelId: string, count: number): void {
		if (count <= 0) return;
		const next = new Map(unreadLines.value);
		next.set(channelId, (next.get(channelId) ?? 0) + count);
		unreadLines.value = next;
	}

	function clearChannel(channelId: string): void {
		let changed = false;

		if (bellCounts.value.has(channelId)) {
			const next = new Map(bellCounts.value);
			next.delete(channelId);
			bellCounts.value = next;
			changed = true;
		}

		if (activityDots.value.has(channelId)) {
			const next = new Map(activityDots.value);
			next.delete(channelId);
			activityDots.value = next;
			changed = true;
		}

		if (unreadLines.value.has(channelId)) {
			const next = new Map(unreadLines.value);
			next.delete(channelId);
			unreadLines.value = next;
			changed = true;
		}

		// suppress unused-variable lint — changed tracks whether any map was mutated
		void changed;
	}

	function clearBellAndActivity(channelId: string): void {
		if (bellCounts.value.has(channelId)) {
			const next = new Map(bellCounts.value);
			next.delete(channelId);
			bellCounts.value = next;
		}
		if (activityDots.value.has(channelId)) {
			const next = new Map(activityDots.value);
			next.delete(channelId);
			activityDots.value = next;
		}
	}

	function clearUnreadLines(channelId: string): void {
		if (unreadLines.value.has(channelId)) {
			const next = new Map(unreadLines.value);
			next.delete(channelId);
			unreadLines.value = next;
		}
	}

	function clearAll(): void {
		bellCounts.value = new Map();
		activityDots.value = new Map();
		unreadLines.value = new Map();
	}

	// -------------------------------------------------------------------------
	// Host-level aggregations
	// -------------------------------------------------------------------------

	function getBellCountForHost(hostId: string): number {
		const channelsStore = useChannelsStore();
		let total = 0;
		for (const [channelId, count] of bellCounts.value) {
			if (channelsStore.channelHostMap.get(channelId) === hostId) {
				total += count;
			}
		}
		return total;
	}

	function getHostActivity(hostId: string): boolean {
		const channelsStore = useChannelsStore();
		for (const [channelId, active] of activityDots.value) {
			if (active && channelsStore.channelHostMap.get(channelId) === hostId) {
				return true;
			}
		}
		return false;
	}

	return {
		bellCounts,
		activityDots,
		unreadLines,
		incrementBellCount,
		setActivity,
		addUnreadLines,
		clearChannel,
		clearBellAndActivity,
		clearUnreadLines,
		clearAll,
		getBellCountForHost,
		getHostActivity,
	};
});
