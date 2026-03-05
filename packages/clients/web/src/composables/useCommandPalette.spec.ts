import type { Host } from "@nexterm/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelsStore } from "../stores/channels.js";
import { useHostsStore } from "../stores/hosts.js";
import { useCommandPalette } from "./useCommandPalette.js";

/**
 * Mock useLayout — useCommandPalette depends on it but we only need stub values.
 * The module-level mock must come before importing the composable via vitest hoisting.
 */
vi.mock("./useLayout.js", () => ({
	useLayout: () => ({
		activeTab: { value: null },
		tabs: { value: [] },
		closeTab: vi.fn(),
		splitPane: vi.fn(),
	}),
}));

function makeHost(id: string, label: string): Host {
	return {
		id,
		label,
		type: "ssh",
		sshHost: "example.com",
		sshPort: 22,
		iconType: "auto",
		trustRemoteHints: "apply",
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
	};
}

describe("useCommandPalette", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	describe("open / close / toggle", () => {
		it("starts closed", () => {
			const palette = useCommandPalette();
			expect(palette.isOpen.value).toBe(false);
		});

		it("open() sets isOpen to true and resets query", () => {
			const palette = useCommandPalette();
			palette.search("stale");
			palette.open();
			expect(palette.isOpen.value).toBe(true);
			expect(palette.query.value).toBe("");
			expect(palette.selectedIndex.value).toBe(0);
		});

		it("close() sets isOpen to false and resets query", () => {
			const palette = useCommandPalette();
			palette.open();
			palette.search("something");
			palette.close();
			expect(palette.isOpen.value).toBe(false);
			expect(palette.query.value).toBe("");
		});

		it("toggle() flips isOpen state", () => {
			const palette = useCommandPalette();
			palette.toggle();
			expect(palette.isOpen.value).toBe(true);
			palette.toggle();
			expect(palette.isOpen.value).toBe(false);
		});
	});

	describe("search / results filtering", () => {
		it("returns all items when query is empty", () => {
			const hostsStore = useHostsStore();
			hostsStore.hosts = [makeHost("h1", "Production"), makeHost("h2", "Staging")];

			const palette = useCommandPalette();
			// Empty query — should include hosts + builtin actions
			const results = palette.results.value;
			const hostResults = results.filter((r) => r.type === "host");
			const actionResults = results.filter((r) => r.type === "action");
			expect(hostResults).toHaveLength(2);
			expect(actionResults.length).toBeGreaterThanOrEqual(4); // New Channel, Split Right, Split Down, Close Tab, ...
		});

		it("filters hosts by label (case-insensitive)", () => {
			const hostsStore = useHostsStore();
			hostsStore.hosts = [
				makeHost("h1", "Production"),
				makeHost("h2", "Staging"),
				makeHost("h3", "Dev Proxy"),
			];

			const palette = useCommandPalette();
			palette.search("prod");

			const hostResults = palette.results.value.filter((r) => r.type === "host");
			expect(hostResults).toHaveLength(1);
			expect(hostResults[0]?.label).toBe("Production");
		});

		it("filters channels by title (case-insensitive)", () => {
			const channelsStore = useChannelsStore();
			channelsStore.channels = [
				{
					id: "c1",
					hostId: "h1",
					status: "alive",
					title: "Build Runner",
					createdAt: "2025-01-01T00:00:00Z",
				},
				{
					id: "c2",
					hostId: "h1",
					status: "alive",
					title: "Log Tail",
					createdAt: "2025-01-01T00:00:00Z",
				},
			];

			const palette = useCommandPalette();
			palette.search("build");

			const channelResults = palette.results.value.filter((r) => r.type === "channel");
			expect(channelResults).toHaveLength(1);
			expect(channelResults[0]?.label).toBe("Build Runner");
		});

		it("filters builtin actions by label", () => {
			const palette = useCommandPalette();
			palette.search("split");

			const actionResults = palette.results.value.filter((r) => r.type === "action");
			expect(actionResults).toHaveLength(2); // Split Right + Split Down
		});

		it("returns empty results when no items match", () => {
			const palette = useCommandPalette();
			palette.search("zzz-no-match-zzz");
			expect(palette.results.value).toHaveLength(0);
		});

		it("trims and lowercases the query before matching", () => {
			const hostsStore = useHostsStore();
			hostsStore.hosts = [makeHost("h1", "Production")];

			const palette = useCommandPalette();
			palette.search("  PRODUCTION  ");

			const hostResults = palette.results.value.filter((r) => r.type === "host");
			expect(hostResults).toHaveLength(1);
		});
	});

	describe("navigation", () => {
		it("search() resets selectedIndex to 0", () => {
			const palette = useCommandPalette();
			palette.open();
			// Move selection down then search to verify reset
			palette.moveDown();
			palette.search("new");
			expect(palette.selectedIndex.value).toBe(0);
		});

		it("moveDown wraps around to the beginning", () => {
			const palette = useCommandPalette();
			palette.search("split"); // 2 results: Split Right + Split Down
			const count = palette.results.value.length;
			expect(count).toBe(2);

			palette.moveDown(); // index 1
			palette.moveDown(); // wraps to 0
			expect(palette.selectedIndex.value).toBe(0);
		});

		it("moveUp wraps around to the end", () => {
			const palette = useCommandPalette();
			palette.search("split"); // 2 results
			const count = palette.results.value.length;
			expect(count).toBe(2);

			// selectedIndex starts at 0, moveUp wraps to last
			palette.moveUp();
			expect(palette.selectedIndex.value).toBe(count - 1);
		});

		it("moveDown is a no-op when results are empty", () => {
			const palette = useCommandPalette();
			palette.search("zzz-no-match-zzz");
			palette.moveDown();
			expect(palette.selectedIndex.value).toBe(0);
		});

		it("moveUp is a no-op when results are empty", () => {
			const palette = useCommandPalette();
			palette.search("zzz-no-match-zzz");
			palette.moveUp();
			expect(palette.selectedIndex.value).toBe(0);
		});
	});

	describe("execute", () => {
		it("execute() closes the palette", () => {
			const palette = useCommandPalette();
			palette.open();
			palette.execute({
				id: "host:h1",
				label: "Test",
				type: "host",
				icon: "X",
				payload: "h1",
			});
			expect(palette.isOpen.value).toBe(false);
		});

		it("executeSelected() is a no-op when results are empty", () => {
			const palette = useCommandPalette();
			palette.search("zzz-no-match-zzz");
			// Should not throw
			palette.executeSelected();
			expect(palette.isOpen.value).toBe(false);
		});
	});
});
