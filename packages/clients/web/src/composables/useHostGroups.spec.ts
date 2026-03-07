import type { Host } from "@nexterm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

function makeHost(overrides: Partial<Host> & { id: string; label: string }): Host {
	return {
		type: "ssh",
		sshHost: "example.com",
		sshPort: 22,
		iconType: "initials",
		trustRemoteHints: "none",
		sortOrder: 0,
		keepAliveSeconds: 0,
		historyRetentionDays: 30,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

const mockHosts = ref<Host[]>([]);

/**
 * Pinia stores unwrap computed/ref at access time, so `store.sortedHosts`
 * returns the raw value. We replicate that with a getter on a plain object.
 */
vi.mock("../stores/hosts.js", () => ({
	useHostsStore: () => ({
		get sortedHosts() {
			return mockHosts.value;
		},
		selectedHostId: null as string | null,
		getHostStatus: () => "offline" as const,
	}),
}));

// Mock localStorage
const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (key: string) => localStorageMap.get(key) ?? null,
	setItem: (key: string, value: string) => localStorageMap.set(key, value),
	removeItem: (key: string) => localStorageMap.delete(key),
});

// Must import AFTER mocks
const { useHostGroups } = await import("./useHostGroups.js");

describe("useHostGroups", () => {
	beforeEach(() => {
		mockHosts.value = [];
		localStorageMap.clear();
	});

	it("separates local host from grouped and ungrouped", async () => {
		mockHosts.value = [
			makeHost({ id: "1", label: "Local", type: "local" }),
			makeHost({ id: "2", label: "Prod", hostGroup: "Production" }),
			makeHost({ id: "3", label: "Dev", hostGroup: null }),
		];

		const { localHost, sections } = useHostGroups();

		await nextTick();

		expect(localHost.value).not.toBeNull();
		expect(localHost.value?.id).toBe("1");

		// Should have 2 sections: "Production" group + ungrouped
		expect(sections.value).toHaveLength(2);
		expect(sections.value[0]?.type).toBe("group");
		expect((sections.value[0] as { name: string }).name).toBe("Production");
		expect(sections.value[0]?.hosts).toHaveLength(1);
		expect(sections.value[0]?.hosts[0]?.id).toBe("2");

		expect(sections.value[1]?.type).toBe("ungrouped");
		expect(sections.value[1]?.hosts).toHaveLength(1);
		expect(sections.value[1]?.hosts[0]?.id).toBe("3");
	});

	it("groups hosts by hostGroup", async () => {
		mockHosts.value = [
			makeHost({ id: "1", label: "S1", hostGroup: "Alpha" }),
			makeHost({ id: "2", label: "S2", hostGroup: "Alpha" }),
			makeHost({ id: "3", label: "S3", hostGroup: "Beta" }),
		];

		const { sections } = useHostGroups();

		await nextTick();

		// 2 group sections: Alpha, Beta (alphabetical)
		expect(sections.value).toHaveLength(2);
		expect((sections.value[0] as { name: string }).name).toBe("Alpha");
		expect(sections.value[0]?.hosts).toHaveLength(2);
		expect((sections.value[1] as { name: string }).name).toBe("Beta");
		expect(sections.value[1]?.hosts).toHaveLength(1);
	});

	it("handles empty host list", async () => {
		mockHosts.value = [];

		const { localHost, sections } = useHostGroups();

		await nextTick();

		expect(localHost.value).toBeNull();
		expect(sections.value).toHaveLength(0);
	});

	it("toggles group collapse and persists to localStorage", async () => {
		mockHosts.value = [makeHost({ id: "1", label: "S1", hostGroup: "MyGroup" })];

		const { sections, toggleGroup } = useHostGroups();

		await nextTick();

		expect(sections.value[0]?.type).toBe("group");
		expect((sections.value[0] as { collapsed: boolean }).collapsed).toBe(false);

		toggleGroup("MyGroup");
		await nextTick();

		expect((sections.value[0] as { collapsed: boolean }).collapsed).toBe(true);
		expect(localStorageMap.get("nexterm:collapsed-host-groups")).toBe(JSON.stringify(["MyGroup"]));

		toggleGroup("MyGroup");
		await nextTick();

		expect((sections.value[0] as { collapsed: boolean }).collapsed).toBe(false);
	});
});
