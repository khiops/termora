import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { PaneNode } from "./useLayout.js";
import { collectTerminalChannelIds } from "./useLayout.js";
import type { PaneSearchHandle } from "./useMultiPaneSearch.js";
import { useMultiPaneSearch } from "./useMultiPaneSearch.js";

// ---------------------------------------------------------------------------
// collectTerminalChannelIds
// ---------------------------------------------------------------------------

describe("collectTerminalChannelIds", () => {
	it("returns single channelId for terminal node", () => {
		const node: PaneNode = { type: "terminal", channelId: "ch-1", paneId: "p1" };
		expect(collectTerminalChannelIds(node)).toEqual(["ch-1"]);
	});

	it("returns empty array for vacant node", () => {
		const node: PaneNode = { type: "vacant", id: "v1" };
		expect(collectTerminalChannelIds(node)).toEqual([]);
	});

	it("returns depth-first ordered channelIds for split tree", () => {
		const node: PaneNode = {
			type: "split",
			direction: "vertical",
			ratio: 0.5,
			first: { type: "terminal", channelId: "ch-A", paneId: "pA" },
			second: { type: "terminal", channelId: "ch-B", paneId: "pB" },
		};
		expect(collectTerminalChannelIds(node)).toEqual(["ch-A", "ch-B"]);
	});

	it("skips vacant nodes in mixed tree", () => {
		const node: PaneNode = {
			type: "split",
			direction: "horizontal",
			ratio: 0.5,
			first: { type: "terminal", channelId: "ch-A", paneId: "pA" },
			second: {
				type: "split",
				direction: "vertical",
				ratio: 0.5,
				first: { type: "vacant", id: "v1" },
				second: { type: "terminal", channelId: "ch-C", paneId: "pC" },
			},
		};
		expect(collectTerminalChannelIds(node)).toEqual(["ch-A", "ch-C"]);
	});

	it("handles deeply nested tree", () => {
		const node: PaneNode = {
			type: "split",
			direction: "vertical",
			ratio: 0.5,
			first: {
				type: "split",
				direction: "horizontal",
				ratio: 0.5,
				first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
				second: { type: "terminal", channelId: "ch-2", paneId: "p2" },
			},
			second: {
				type: "split",
				direction: "horizontal",
				ratio: 0.5,
				first: { type: "terminal", channelId: "ch-3", paneId: "p3" },
				second: { type: "terminal", channelId: "ch-4", paneId: "p4" },
			},
		};
		expect(collectTerminalChannelIds(node)).toEqual(["ch-1", "ch-2", "ch-3", "ch-4"]);
	});
});

// ---------------------------------------------------------------------------
// useMultiPaneSearch
// ---------------------------------------------------------------------------

/** Create a mock PaneSearchHandle */
function mockHandle(channelId: string, matchCount = 0): PaneSearchHandle {
	return {
		channelId,
		search: vi.fn(),
		findNext: vi.fn(),
		findPrevious: vi.fn(),
		clear: vi.fn(),
		matchCount: ref(matchCount),
		currentMatch: ref(matchCount > 0 ? 1 : 0),
	};
}

describe("useMultiPaneSearch", () => {
	let scope: ReturnType<typeof effectScope>;
	let registry: ReturnType<typeof useMultiPaneSearch>;

	beforeEach(() => {
		setActivePinia(createPinia());
		scope = effectScope();
		scope.run(() => {
			registry = useMultiPaneSearch();
		});
	});

	afterEach(() => {
		scope.stop();
	});

	// ---- Registration ----

	describe("register/unregister", () => {
		it("registers and unregisters handles", () => {
			const h1 = mockHandle("ch-1");
			const h2 = mockHandle("ch-2");
			registry.register(h1);
			registry.register(h2);

			// totalMatchCount should reflect registered handles
			expect(registry.totalMatchCount.value).toBe(0);

			registry.unregister("ch-1");
			// Should not throw; remaining handle works fine
			expect(registry.totalMatchCount.value).toBe(0);
		});
	});

	// ---- Scope ----

	describe("scope", () => {
		it("defaults to pane", () => {
			expect(registry.scope.value).toBe("pane");
		});

		it("can be set to all", () => {
			registry.setScope("all");
			expect(registry.scope.value).toBe("all");
		});

		it("clears all handles when switching back to pane", () => {
			const h1 = mockHandle("ch-1", 5);
			registry.register(h1);
			registry.setScope("all");
			registry.setScope("pane");
			expect(h1.clear).toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBeNull();
		});
	});

	// ---- searchAll ----

	describe("searchAll", () => {
		it("calls search on all registered handles matching layout", () => {
			const h1 = mockHandle("ch-1");
			const h2 = mockHandle("ch-2");
			const h3 = mockHandle("ch-3"); // not in layout
			registry.register(h1);
			registry.register(h2);
			registry.register(h3);

			const layout: PaneNode = {
				type: "split",
				direction: "vertical",
				ratio: 0.5,
				first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
				second: { type: "terminal", channelId: "ch-2", paneId: "p2" },
			};

			registry.searchAll("hello", layout);

			expect(h1.search).toHaveBeenCalledWith("hello");
			expect(h2.search).toHaveBeenCalledWith("hello");
			expect(h3.search).not.toHaveBeenCalled();
		});
	});

	// ---- totalMatchCount ----

	describe("totalMatchCount", () => {
		it("aggregates match counts from all handles", () => {
			const h1 = mockHandle("ch-1", 3);
			const h2 = mockHandle("ch-2", 7);
			registry.register(h1);
			registry.register(h2);

			expect(registry.totalMatchCount.value).toBe(10);
		});

		it("updates when handle match count changes", () => {
			const h1 = mockHandle("ch-1", 3);
			registry.register(h1);
			expect(registry.totalMatchCount.value).toBe(3);

			h1.matchCount.value = 10;
			expect(registry.totalMatchCount.value).toBe(10);
		});
	});

	// ---- findNextAll ----

	describe("findNextAll", () => {
		const layout: PaneNode = {
			type: "split",
			direction: "vertical",
			ratio: 0.5,
			first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
			second: { type: "terminal", channelId: "ch-2", paneId: "p2" },
		};

		it("calls findNext on current pane when not at last match", () => {
			const h1 = mockHandle("ch-1", 5);
			h1.currentMatch.value = 2; // not at last
			const h2 = mockHandle("ch-2", 3);
			registry.register(h1);
			registry.register(h2);

			registry.findNextAll("ch-1", layout);

			expect(h1.findNext).toHaveBeenCalled();
			expect(h2.findNext).not.toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-1");
		});

		it("moves to next pane when at last match", () => {
			const h1 = mockHandle("ch-1", 3);
			h1.currentMatch.value = 3; // at last match
			const h2 = mockHandle("ch-2", 5);
			registry.register(h1);
			registry.register(h2);

			registry.findNextAll("ch-1", layout);

			expect(h1.findNext).not.toHaveBeenCalled();
			expect(h2.findNext).toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-2");
		});

		it("wraps around from last pane to first", () => {
			const h1 = mockHandle("ch-1", 5);
			const h2 = mockHandle("ch-2", 3);
			h2.currentMatch.value = 3; // at last match
			registry.register(h1);
			registry.register(h2);

			registry.findNextAll("ch-2", layout);

			expect(h1.findNext).toHaveBeenCalled();
			expect(h2.findNext).not.toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-1");
		});

		it("skips panes with zero matches", () => {
			const threePane: PaneNode = {
				type: "split",
				direction: "vertical",
				ratio: 0.5,
				first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
				second: {
					type: "split",
					direction: "horizontal",
					ratio: 0.5,
					first: { type: "terminal", channelId: "ch-2", paneId: "p2" },
					second: { type: "terminal", channelId: "ch-3", paneId: "p3" },
				},
			};

			const h1 = mockHandle("ch-1", 2);
			h1.currentMatch.value = 2; // at last
			const h2 = mockHandle("ch-2", 0); // no matches
			const h3 = mockHandle("ch-3", 4);
			registry.register(h1);
			registry.register(h2);
			registry.register(h3);

			registry.findNextAll("ch-1", threePane);

			expect(h2.findNext).not.toHaveBeenCalled();
			expect(h3.findNext).toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-3");
		});

		it("calls onFocusPane when crossing to a different pane", () => {
			const focusFn = vi.fn();
			registry.onFocusPane.value = focusFn;

			const h1 = mockHandle("ch-1", 2);
			h1.currentMatch.value = 2; // at last
			const h2 = mockHandle("ch-2", 3);
			registry.register(h1);
			registry.register(h2);

			registry.findNextAll("ch-1", layout);

			expect(focusFn).toHaveBeenCalledWith("ch-2");
		});

		it("does not call onFocusPane when staying in same pane", () => {
			const focusFn = vi.fn();
			registry.onFocusPane.value = focusFn;

			const h1 = mockHandle("ch-1", 5);
			h1.currentMatch.value = 2; // not at last
			registry.register(h1);

			registry.findNextAll("ch-1", layout);

			expect(focusFn).not.toHaveBeenCalled();
		});
	});

	// ---- findPreviousAll ----

	describe("findPreviousAll", () => {
		const layout: PaneNode = {
			type: "split",
			direction: "vertical",
			ratio: 0.5,
			first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
			second: { type: "terminal", channelId: "ch-2", paneId: "p2" },
		};

		it("calls findPrevious on current pane when not at first match", () => {
			const h1 = mockHandle("ch-1", 5);
			h1.currentMatch.value = 3; // not at first
			const h2 = mockHandle("ch-2", 3);
			registry.register(h1);
			registry.register(h2);

			registry.findPreviousAll("ch-1", layout);

			expect(h1.findPrevious).toHaveBeenCalled();
			expect(h2.findPrevious).not.toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-1");
		});

		it("moves to previous pane when at first match", () => {
			const h1 = mockHandle("ch-1", 3);
			const h2 = mockHandle("ch-2", 5);
			h2.currentMatch.value = 1; // at first match
			registry.register(h1);
			registry.register(h2);

			registry.findPreviousAll("ch-2", layout);

			expect(h1.findPrevious).toHaveBeenCalled();
			expect(h2.findPrevious).not.toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-1");
		});

		it("wraps around from first pane to last", () => {
			const h1 = mockHandle("ch-1", 3);
			h1.currentMatch.value = 1; // at first
			const h2 = mockHandle("ch-2", 5);
			registry.register(h1);
			registry.register(h2);

			registry.findPreviousAll("ch-1", layout);

			expect(h2.findPrevious).toHaveBeenCalled();
			expect(h1.findPrevious).not.toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBe("ch-2");
		});
	});

	// ---- totalCurrentMatch ----

	describe("totalCurrentMatch", () => {
		it("returns 0 when no active match pane", () => {
			expect(registry.totalCurrentMatch.value).toBe(0);
		});

		it("calculates aggregated index across panes", () => {
			const layout: PaneNode = {
				type: "split",
				direction: "vertical",
				ratio: 0.5,
				first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
				second: { type: "terminal", channelId: "ch-2", paneId: "p2" },
			};

			const h1 = mockHandle("ch-1", 5);
			h1.currentMatch.value = 3;
			const h2 = mockHandle("ch-2", 8);
			h2.currentMatch.value = 2;
			registry.register(h1);
			registry.register(h2);

			// Populate lastOrderedIds by calling searchAll
			registry.searchAll("test", layout);

			// Simulate active match in ch-2
			registry.matchPaneChannelId.value = "ch-2";

			// Should be: 5 (all matches in ch-1) + 2 (current in ch-2) = 7
			expect(registry.totalCurrentMatch.value).toBe(7);
		});
	});

	// ---- clearAll ----

	describe("clearAll", () => {
		it("clears all registered handles", () => {
			const h1 = mockHandle("ch-1", 5);
			const h2 = mockHandle("ch-2", 3);
			registry.register(h1);
			registry.register(h2);

			registry.clearAll();

			expect(h1.clear).toHaveBeenCalled();
			expect(h2.clear).toHaveBeenCalled();
			expect(registry.matchPaneChannelId.value).toBeNull();
		});
	});
});
