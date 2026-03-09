import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectScope, nextTick } from "vue";
import { countPanes, useLayout } from "./useLayout.js";
import type { PaneNode } from "./useLayout.js";

let layout: ReturnType<typeof useLayout>;
let scope: ReturnType<typeof effectScope>;

beforeEach(() => {
	localStorage.clear();
	setActivePinia(createPinia());
	scope = effectScope();
	scope.run(() => {
		layout = useLayout();
	});
});

afterEach(() => {
	scope.stop();
});

// ── Helpers ──────────────────────────────────────────────────────────────

function openTabs(...labels: string[]): void {
	for (const label of labels) {
		layout.openTab(`ch-${label}`, label);
	}
}

/** Check that every leaf in a pane tree is vacant. */
function isAllVacant(node: PaneNode | null | undefined): boolean {
	if (node === null || node === undefined) return false;
	if (node.type === "vacant") return true;
	if (node.type === "terminal") return false;
	return isAllVacant(node.first) && isAllVacant(node.second);
}

// ── closeOthers ──────────────────────────────────────────────────────────

describe("closeOthers", () => {
	it("vacates all tabs except the specified index", () => {
		openTabs("A", "B", "C", "D");
		expect(layout.tabs.value).toHaveLength(4);

		layout.closeOthers(1); // keep B

		// All tabs remain
		expect(layout.tabs.value).toHaveLength(4);
		// B's layout should still be a terminal
		expect(layout.layouts.value["ch-B"]?.type).toBe("terminal");
		// Others should be all-vacant
		expect(isAllVacant(layout.layouts.value["ch-A"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-C"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-D"])).toBe(true);
	});

	it("handles single tab (no-op)", () => {
		openTabs("A");
		layout.closeOthers(0);

		expect(layout.tabs.value).toHaveLength(1);
		expect(layout.tabs.value[0]?.channelId).toBe("ch-A");
		expect(layout.layouts.value["ch-A"]?.type).toBe("terminal");
	});

	it("keeps activeTabIndex unchanged", () => {
		openTabs("A", "B", "C");
		layout.setActiveTab(2); // C is active
		expect(layout.activeTabIndex.value).toBe(2);

		layout.closeOthers(2); // keep C

		// All tabs remain, index stays
		expect(layout.tabs.value).toHaveLength(3);
		expect(layout.activeTabIndex.value).toBe(2);
		expect(layout.layouts.value["ch-C"]?.type).toBe("terminal");
		expect(isAllVacant(layout.layouts.value["ch-A"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-B"])).toBe(true);
	});
});

// ── closeToRight ─────────────────────────────────────────────────────────

describe("closeToRight", () => {
	it("vacates all tabs to the right of specified index", () => {
		openTabs("A", "B", "C", "D");

		layout.closeToRight(1); // vacate C, D

		// All tabs remain
		expect(layout.tabs.value).toHaveLength(4);
		// A and B untouched
		expect(layout.layouts.value["ch-A"]?.type).toBe("terminal");
		expect(layout.layouts.value["ch-B"]?.type).toBe("terminal");
		// C and D are all-vacant
		expect(isAllVacant(layout.layouts.value["ch-C"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-D"])).toBe(true);
	});

	it("is no-op when index is last tab", () => {
		openTabs("A", "B", "C");

		layout.closeToRight(2);

		expect(layout.tabs.value).toHaveLength(3);
		expect(layout.layouts.value["ch-C"]?.type).toBe("terminal");
	});

	it("does not affect tabs to the left", () => {
		openTabs("A", "B", "C", "D");

		layout.closeToRight(2); // vacate D only

		expect(layout.tabs.value).toHaveLength(4);
		expect(layout.layouts.value["ch-A"]?.type).toBe("terminal");
		expect(layout.layouts.value["ch-B"]?.type).toBe("terminal");
		expect(layout.layouts.value["ch-C"]?.type).toBe("terminal");
		expect(isAllVacant(layout.layouts.value["ch-D"])).toBe(true);
	});
});

// ── closeAll ─────────────────────────────────────────────────────────────

describe("closeAll", () => {
	it("vacates all tabs when no welcome tab", () => {
		openTabs("A", "B", "C");

		layout.closeAll();

		// All tabs remain but layouts are all-vacant
		expect(layout.tabs.value).toHaveLength(3);
		expect(isAllVacant(layout.layouts.value["ch-A"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-B"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-C"])).toBe(true);
	});

	it("keeps welcome tab layout when exceptWelcomeId is provided", () => {
		openTabs("A", "B", "C");

		layout.closeAll("ch-B");

		// All tabs remain
		expect(layout.tabs.value).toHaveLength(3);
		// B's layout untouched
		expect(layout.layouts.value["ch-B"]?.type).toBe("terminal");
		// Others are all-vacant
		expect(isAllVacant(layout.layouts.value["ch-A"])).toBe(true);
		expect(isAllVacant(layout.layouts.value["ch-C"])).toBe(true);
	});

	it("is no-op when only welcome tab exists", () => {
		openTabs("A");

		layout.closeAll("ch-A");

		expect(layout.tabs.value).toHaveLength(1);
		expect(layout.tabs.value[0]?.channelId).toBe("ch-A");
		expect(layout.layouts.value["ch-A"]?.type).toBe("terminal");
	});
});

// ── vacatePane ────────────────────────────────────────────────────────────

describe("vacatePane", () => {
	it("replaces terminal node with vacant in split layout", () => {
		openTabs("A");
		// Split the pane to create a split layout
		layout.splitPane("ch-A", "vertical", "ch-B", "B");
		const root = layout.layouts.value["ch-A"];
		expect(root).not.toBeNull();
		expect(root?.type).toBe("split");

		// Vacate the second pane (ch-B)
		layout.vacatePane("ch-B");

		const updated = layout.layouts.value["ch-A"];
		expect(updated).not.toBeNull();
		expect(updated?.type).toBe("split");
		if (updated?.type === "split") {
			expect(updated.first.type).toBe("terminal");
			expect(updated.second.type).toBe("vacant");
			if (updated.second.type === "vacant") {
				expect(updated.second.id).toBeTruthy();
			}
		}
	});

	it("does nothing for non-existent channelId", () => {
		openTabs("A");
		layout.splitPane("ch-A", "vertical", "ch-B", "B");
		const before = layout.layouts.value["ch-A"];

		layout.vacatePane("ch-nonexistent");

		const after = layout.layouts.value["ch-A"];
		expect(after).toEqual(before);
	});
});

// ── rearrangeVacant ───────────────────────────────────────────────────────

describe("rearrangeVacant", () => {
	it("removes vacant node and collapses parent split", () => {
		openTabs("A");
		layout.splitPane("ch-A", "vertical", "ch-B", "B");

		// Vacate ch-B to create a vacant node
		layout.vacatePane("ch-B");
		const afterVacate = layout.layouts.value["ch-A"];
		expect(afterVacate?.type).toBe("split");

		// Get the vacant ID
		let vacantId = "";
		if (afterVacate?.type === "split" && afterVacate.second.type === "vacant") {
			vacantId = afterVacate.second.id;
		}
		expect(vacantId).toBeTruthy();

		// Rearrange — should collapse the split, leaving just ch-A
		layout.rearrangeVacant(vacantId);

		const afterRearrange = layout.layouts.value["ch-A"];
		expect(afterRearrange?.type).toBe("terminal");
		if (afterRearrange?.type === "terminal") {
			expect(afterRearrange.channelId).toBe("ch-A");
		}
	});

	it("does nothing when vacant is root node (single pane)", () => {
		openTabs("A");
		// Vacate root pane
		layout.vacatePane("ch-A");
		const afterVacate = layout.layouts.value["ch-A"];
		expect(afterVacate?.type).toBe("vacant");

		let vacantId = "";
		if (afterVacate?.type === "vacant") {
			vacantId = afterVacate.id;
		}

		// Rearranging root vacant should be a no-op
		layout.rearrangeVacant(vacantId);

		const afterRearrange = layout.layouts.value["ch-A"];
		expect(afterRearrange?.type).toBe("vacant");
	});
});

// ── fillVacant ────────────────────────────────────────────────────────────

describe("fillVacant", () => {
	it("replaces vacant node with terminal node", () => {
		openTabs("A");
		layout.splitPane("ch-A", "vertical", "ch-B", "B");

		// Vacate ch-B
		layout.vacatePane("ch-B");
		const afterVacate = layout.layouts.value["ch-A"];
		let vacantId = "";
		if (afterVacate?.type === "split" && afterVacate.second.type === "vacant") {
			vacantId = afterVacate.second.id;
		}
		expect(vacantId).toBeTruthy();

		// Fill the vacant with a new channel
		layout.fillVacant(vacantId, "ch-C");

		const afterFill = layout.layouts.value["ch-A"];
		expect(afterFill?.type).toBe("split");
		if (afterFill?.type === "split") {
			expect(afterFill.second.type).toBe("terminal");
			if (afterFill.second.type === "terminal") {
				expect(afterFill.second.channelId).toBe("ch-C");
			}
		}
	});

	it("does nothing for non-existent vacantId", () => {
		openTabs("A");
		layout.splitPane("ch-A", "vertical", "ch-B", "B");
		layout.vacatePane("ch-B");
		const before = layout.layouts.value["ch-A"];

		layout.fillVacant("nonexistent-id", "ch-C");

		const after = layout.layouts.value["ch-A"];
		expect(after).toEqual(before);
	});
});

// ── countPanes ────────────────────────────────────────────────────────────

describe("countPanes", () => {
	it("returns 1 for single terminal", () => {
		const node: PaneNode = { type: "terminal", channelId: "ch-1", paneId: "p1" };
		expect(countPanes(node)).toBe(1);
	});

	it("returns 1 for single vacant", () => {
		const node: PaneNode = { type: "vacant", id: "v1" };
		expect(countPanes(node)).toBe(1);
	});

	it("returns 2 for split with terminal and vacant", () => {
		const node: PaneNode = {
			type: "split",
			direction: "vertical",
			ratio: 0.5,
			first: { type: "terminal", channelId: "ch-1", paneId: "p1" },
			second: { type: "vacant", id: "v1" },
		};
		expect(countPanes(node)).toBe(2);
	});

	it("returns 4 for nested splits", () => {
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
				first: { type: "vacant", id: "v1" },
				second: { type: "terminal", channelId: "ch-3", paneId: "p3" },
			},
		};
		expect(countPanes(node)).toBe(4);
	});
});

// -- movePaneTo -----------------------------------------------------------------

describe("movePaneTo", () => {
	it("moves pane from one tab to another (center zone)", () => {
		openTabs("A", "B");
		// Tab A has one pane, Tab B has one pane

		// Get the paneId of tab B's root node
		const tabBRoot = layout.layouts.value["ch-B"];
		expect(tabBRoot).not.toBeNull();
		expect(tabBRoot?.type).toBe("terminal");
		const targetPaneId = tabBRoot?.type === "terminal" ? tabBRoot.paneId : "";

		// Get ch-A's root paneId for reference
		const tabARoot = layout.layouts.value["ch-A"];
		expect(tabARoot?.type).toBe("terminal");

		// Move ch-A into tab B (center = replace)
		layout.movePaneTo("ch-A", targetPaneId, "ch-B", "center");

		// Tab B should now contain ch-A
		const updatedB = layout.layouts.value["ch-B"];
		expect(updatedB?.type).toBe("terminal");
		if (updatedB?.type === "terminal") {
			expect(updatedB.channelId).toBe("ch-A");
		}

		// Tab A should have a vacant node (source was vacated)
		const updatedA = layout.layouts.value["ch-A"];
		expect(updatedA?.type).toBe("vacant");
	});

	it("creates horizontal split when dropping on left zone", () => {
		openTabs("A", "B");

		const tabBRoot = layout.layouts.value["ch-B"];
		const targetPaneId = tabBRoot?.type === "terminal" ? tabBRoot.paneId : "";

		layout.movePaneTo("ch-A", targetPaneId, "ch-B", "left");

		const updatedB = layout.layouts.value["ch-B"];
		expect(updatedB?.type).toBe("split");
		if (updatedB?.type === "split") {
			// Left zone: source goes first, target goes second
			expect(updatedB.direction).toBe("vertical");
			expect(updatedB.first.type).toBe("terminal");
			if (updatedB.first.type === "terminal") {
				expect(updatedB.first.channelId).toBe("ch-A");
			}
			expect(updatedB.second.type).toBe("terminal");
			if (updatedB.second.type === "terminal") {
				expect(updatedB.second.channelId).toBe("ch-B");
			}
		}
	});

	it("creates vertical split when dropping on bottom zone", () => {
		openTabs("A", "B");

		const tabBRoot = layout.layouts.value["ch-B"];
		const targetPaneId = tabBRoot?.type === "terminal" ? tabBRoot.paneId : "";

		layout.movePaneTo("ch-A", targetPaneId, "ch-B", "bottom");

		const updatedB = layout.layouts.value["ch-B"];
		expect(updatedB?.type).toBe("split");
		if (updatedB?.type === "split") {
			// Bottom zone: target goes first, source goes second
			expect(updatedB.direction).toBe("horizontal");
			expect(updatedB.first.type).toBe("terminal");
			if (updatedB.first.type === "terminal") {
				expect(updatedB.first.channelId).toBe("ch-B");
			}
			expect(updatedB.second.type).toBe("terminal");
			if (updatedB.second.type === "terminal") {
				expect(updatedB.second.channelId).toBe("ch-A");
			}
		}
	});

	it("vacates source pane after move", () => {
		openTabs("A", "B");
		layout.setActiveTab(0); // switch to tab A before splitting
		// Split tab A to have two panes
		layout.splitPane("ch-A", "vertical", "ch-C", "C");

		const tabBRoot = layout.layouts.value["ch-B"];
		const targetPaneId = tabBRoot?.type === "terminal" ? tabBRoot.paneId : "";

		// Move ch-C from tab A into tab B
		layout.movePaneTo("ch-C", targetPaneId, "ch-B", "center");

		// Tab A should still be split but second child is now vacant
		const updatedA = layout.layouts.value["ch-A"];
		expect(updatedA?.type).toBe("split");
		if (updatedA?.type === "split") {
			expect(updatedA.first.type).toBe("terminal");
			expect(updatedA.second.type).toBe("vacant");
		}

		// Tab B should now contain ch-C
		const updatedB = layout.layouts.value["ch-B"];
		expect(updatedB?.type).toBe("terminal");
		if (updatedB?.type === "terminal") {
			expect(updatedB.channelId).toBe("ch-C");
		}
	});

	it("handles same-tab move (rearrange panes within tab)", () => {
		openTabs("A");
		layout.splitPane("ch-A", "vertical", "ch-B", "B");

		const root = layout.layouts.value["ch-A"];
		expect(root?.type).toBe("split");
		if (root?.type !== "split") return;

		// Get paneId of first child (ch-A)
		const firstPaneId = root.first.type === "terminal" ? root.first.paneId : "";

		// Move ch-B onto ch-A (center) — should replace ch-A with ch-B, vacate ch-B's old slot
		layout.movePaneTo("ch-B", firstPaneId, "ch-A", "center");

		const updated = layout.layouts.value["ch-A"];
		expect(updated?.type).toBe("split");
		if (updated?.type === "split") {
			// First should now be ch-B, second should be vacant
			expect(updated.first.type).toBe("terminal");
			if (updated.first.type === "terminal") {
				expect(updated.first.channelId).toBe("ch-B");
			}
			expect(updated.second.type).toBe("vacant");
		}
	});
});

// -- moveToNewTab ---------------------------------------------------------------

describe("moveToNewTab", () => {
	it("moves pane from split into a new tab", () => {
		openTabs("A");
		layout.splitPane("ch-A", "vertical", "ch-B", "B");
		expect(layout.tabs.value).toHaveLength(1);

		// Move ch-B to a new tab at index 1
		layout.moveToNewTab("ch-B", 1);

		// Should now have 2 tabs
		expect(layout.tabs.value).toHaveLength(2);
		expect(layout.tabs.value[1]?.channelId).toBe("ch-B");

		// Tab A should have ch-B vacated
		const tabA = layout.layouts.value["ch-A"];
		expect(tabA?.type).toBe("split");
		if (tabA?.type === "split") {
			expect(tabA.second.type).toBe("vacant");
		}

		// New tab should have ch-B as single pane
		const tabB = layout.layouts.value["ch-B"];
		expect(tabB?.type).toBe("terminal");
		if (tabB?.type === "terminal") {
			expect(tabB.channelId).toBe("ch-B");
		}

		// Active tab should be the new one
		expect(layout.activeTabIndex.value).toBe(1);
	});
});

// -- findTabForChannel ----------------------------------------------------------

describe("findTabForChannel", () => {
	it("finds the tab containing a channel", () => {
		openTabs("A", "B");
		layout.setActiveTab(0); // switch to tab A before splitting
		layout.splitPane("ch-A", "vertical", "ch-C", "C");

		expect(layout.findTabForChannel("ch-A")).toBe("ch-A");
		expect(layout.findTabForChannel("ch-C")).toBe("ch-A");
		expect(layout.findTabForChannel("ch-B")).toBe("ch-B");
	});

	it("returns null for unknown channel", () => {
		openTabs("A");
		expect(layout.findTabForChannel("ch-unknown")).toBeNull();
	});
});

// -- reorderTab ----------------------------------------------------------------

describe("reorderTab", () => {
	it("moves tab B before tab A: [A,B,C] → [B,A,C]", () => {
		openTabs("A", "B", "C");
		layout.reorderTab(1, 0);
		expect(layout.tabs.value.map((t) => t.channelId)).toEqual(["ch-B", "ch-A", "ch-C"]);
	});

	it("moves last tab to first: [A,B,C] → [C,A,B]", () => {
		openTabs("A", "B", "C");
		layout.reorderTab(2, 0);
		expect(layout.tabs.value.map((t) => t.channelId)).toEqual(["ch-C", "ch-A", "ch-B"]);
	});

	it("moves first tab to last: [A,B,C] → [B,C,A]", () => {
		openTabs("A", "B", "C");
		layout.reorderTab(0, 2);
		expect(layout.tabs.value.map((t) => t.channelId)).toEqual(["ch-B", "ch-C", "ch-A"]);
	});

	it("same index is a no-op", () => {
		openTabs("A", "B", "C");
		layout.reorderTab(1, 1);
		expect(layout.tabs.value.map((t) => t.channelId)).toEqual(["ch-A", "ch-B", "ch-C"]);
	});

	it("active tab follows drag: active=B(1), reorder(1,0) → active=0", () => {
		openTabs("A", "B", "C");
		layout.setActiveTab(1); // B is active
		layout.reorderTab(1, 0);
		expect(layout.tabs.value[0]?.channelId).toBe("ch-B");
		expect(layout.activeTabIndex.value).toBe(0);
	});

	it("active tab shifts left: active=C(2), reorder(0,2) → active=1", () => {
		openTabs("A", "B", "C");
		layout.setActiveTab(2); // C is active
		layout.reorderTab(0, 2);
		// A moved from before C to after C → C shifts left
		expect(layout.activeTabIndex.value).toBe(1);
	});

	it("active tab shifts right: active=A(0), reorder(2,0) → active=1", () => {
		openTabs("A", "B", "C");
		layout.setActiveTab(0); // A is active
		layout.reorderTab(2, 0);
		// C moved from after A to before A → A shifts right
		expect(layout.activeTabIndex.value).toBe(1);
	});

	it("out-of-range fromIndex is a no-op", () => {
		openTabs("A", "B", "C");
		const before = layout.tabs.value.map((t) => t.channelId);
		layout.reorderTab(-1, 0);
		expect(layout.tabs.value.map((t) => t.channelId)).toEqual(before);
	});

	it("persists to localStorage after reorder", async () => {
		openTabs("A", "B", "C");
		layout.reorderTab(1, 0);
		// Flush the Vue watcher (deep watch runs post-flush)
		await nextTick();
		const stored = localStorage.getItem("nexterm:layout");
		expect(stored).not.toBeNull();
		if (!stored) return;
		const parsed = JSON.parse(stored) as { tabs: { channelId: string }[] };
		expect(parsed.tabs[0]?.channelId).toBe("ch-B");
		expect(parsed.tabs[1]?.channelId).toBe("ch-A");
	});
});
