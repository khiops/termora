import { describe, expect, it, vi } from "vitest";
import { useRename } from "./useRename.js";

describe("useRename", () => {
	it("initializes with isEditing=false and empty editValue", () => {
		const { isEditing, editValue } = useRename({ onCommit: vi.fn() });
		expect(isEditing.value).toBe(false);
		expect(editValue.value).toBe("");
	});

	describe("startRename", () => {
		it("sets isEditing to true and editValue to the given label", () => {
			const { isEditing, editValue, startRename } = useRename({ onCommit: vi.fn() });
			startRename("Terminal 1");
			expect(isEditing.value).toBe(true);
			expect(editValue.value).toBe("Terminal 1");
		});
	});

	describe("commitRename", () => {
		it("calls onCommit with trimmed value when it differs from original", () => {
			const onCommit = vi.fn();
			const { startRename, editValue, commitRename } = useRename({ onCommit });
			startRename("Old Name");
			editValue.value = "  New Name  ";
			commitRename();
			expect(onCommit).toHaveBeenCalledOnce();
			expect(onCommit).toHaveBeenCalledWith("New Name");
		});

		it("does NOT call onCommit when value is unchanged", () => {
			const onCommit = vi.fn();
			const { startRename, commitRename } = useRename({ onCommit });
			startRename("Same");
			// editValue stays "Same" — no modification
			commitRename();
			expect(onCommit).not.toHaveBeenCalled();
		});

		it("does NOT call onCommit when value is empty after trimming", () => {
			const onCommit = vi.fn();
			const { startRename, editValue, commitRename } = useRename({ onCommit });
			startRename("Hello");
			editValue.value = "   ";
			commitRename();
			expect(onCommit).not.toHaveBeenCalled();
		});

		it("sets isEditing to false after commit", () => {
			const { isEditing, startRename, editValue, commitRename } = useRename({
				onCommit: vi.fn(),
			});
			startRename("Old");
			editValue.value = "New";
			commitRename();
			expect(isEditing.value).toBe(false);
		});

		it("sets isEditing to false even when onCommit is not called (no change)", () => {
			const { isEditing, startRename, commitRename } = useRename({ onCommit: vi.fn() });
			startRename("Same");
			commitRename();
			expect(isEditing.value).toBe(false);
		});

		it("is a no-op when not currently editing", () => {
			const onCommit = vi.fn();
			const { commitRename } = useRename({ onCommit });
			// Never called startRename
			commitRename();
			expect(onCommit).not.toHaveBeenCalled();
		});
	});

	describe("cancelRename", () => {
		it("sets isEditing to false", () => {
			const { isEditing, startRename, cancelRename } = useRename({ onCommit: vi.fn() });
			startRename("Test");
			expect(isEditing.value).toBe(true);
			cancelRename();
			expect(isEditing.value).toBe(false);
		});
	});

	describe("editValue reactivity", () => {
		it("can be modified externally (simulating v-model)", () => {
			const { editValue, startRename } = useRename({ onCommit: vi.fn() });
			startRename("Initial");
			editValue.value = "Changed";
			expect(editValue.value).toBe("Changed");
		});
	});
});
