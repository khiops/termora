import type { Host } from "@nexterm/shared";
import { computed, ref } from "vue";
import { useHostsStore } from "../stores/hosts.js";

const COLLAPSED_KEY = "nexterm:collapsed-host-groups";

export interface HostGroupSection {
	type: "group";
	name: string;
	hosts: Host[];
	collapsed: boolean;
}

export interface UngroupedSection {
	type: "ungrouped";
	hosts: Host[];
}

export type HostSection = HostGroupSection | UngroupedSection;

function loadCollapsedGroups(): Set<string> {
	try {
		const raw = localStorage.getItem(COLLAPSED_KEY);
		if (!raw) return new Set();
		return new Set(JSON.parse(raw) as string[]);
	} catch {
		return new Set();
	}
}

function saveCollapsedGroups(set: Set<string>): void {
	localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
}

export function useHostGroups() {
	const hostsStore = useHostsStore();
	const collapsedGroups = ref(loadCollapsedGroups());

	const sections = computed<HostSection[]>(() => {
		const grouped = new Map<string, Host[]>();
		const ungrouped: Host[] = [];

		for (const host of hostsStore.sortedHosts) {
			if (host.type === "local") {
				// Local host rendered separately, skip
				continue;
			}
			if (host.hostGroup) {
				const list = grouped.get(host.hostGroup) ?? [];
				list.push(host);
				grouped.set(host.hostGroup, list);
			} else {
				ungrouped.push(host);
			}
		}

		const result: HostSection[] = [];

		// Groups follow alphabetically
		for (const [name, hosts] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			result.push({
				type: "group",
				name,
				hosts,
				collapsed: collapsedGroups.value.has(name),
			});
		}

		// Ungrouped at the bottom
		if (ungrouped.length > 0) {
			result.push({ type: "ungrouped", hosts: ungrouped });
		}

		return result;
	});

	// The local host, always rendered first separately
	const localHost = computed(() => hostsStore.sortedHosts.find((h) => h.type === "local") ?? null);

	function toggleGroup(name: string): void {
		const set = new Set(collapsedGroups.value);
		if (set.has(name)) set.delete(name);
		else set.add(name);
		collapsedGroups.value = set;
		saveCollapsedGroups(set);
	}

	return {
		sections,
		localHost,
		collapsedGroups,
		toggleGroup,
	};
}
