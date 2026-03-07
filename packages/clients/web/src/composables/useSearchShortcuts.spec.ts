import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useSearchShortcuts } from "./useSearchShortcuts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireKeydown(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
	const ev = new KeyboardEvent("keydown", {
		key,
		altKey: true,
		bubbles: true,
		cancelable: true,
		...modifiers,
	});
	document.dispatchEvent(ev);
	return ev;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSearchShortcuts", () => {
	let onToggleCase: ReturnType<typeof vi.fn>;
	let onToggleRegex: ReturnType<typeof vi.fn>;
	let onToggleWholeWord: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onToggleCase = vi.fn();
		onToggleRegex = vi.fn();
		onToggleWholeWord = vi.fn();
	});

	it("Alt+C calls onToggleCase when search is open", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		fireKeydown("c");
		expect(onToggleCase).toHaveBeenCalledOnce();

		scope.stop();
	});

	it("Alt+R calls onToggleRegex when search is open", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		fireKeydown("r");
		expect(onToggleRegex).toHaveBeenCalledOnce();

		scope.stop();
	});

	it("Alt+W calls onToggleWholeWord when search is open", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		fireKeydown("w");
		expect(onToggleWholeWord).toHaveBeenCalledOnce();

		scope.stop();
	});

	it("shortcuts do nothing when search is closed", () => {
		const isOpen = ref(false);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		fireKeydown("c");
		fireKeydown("r");
		fireKeydown("w");

		expect(onToggleCase).not.toHaveBeenCalled();
		expect(onToggleRegex).not.toHaveBeenCalled();
		expect(onToggleWholeWord).not.toHaveBeenCalled();

		scope.stop();
	});

	it("ignores keys without Alt modifier", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		// Fire without altKey
		const ev = new KeyboardEvent("keydown", {
			key: "c",
			altKey: false,
			bubbles: true,
		});
		document.dispatchEvent(ev);

		expect(onToggleCase).not.toHaveBeenCalled();

		scope.stop();
	});

	it("ignores unrelated Alt+key combos", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		fireKeydown("x");

		expect(onToggleCase).not.toHaveBeenCalled();
		expect(onToggleRegex).not.toHaveBeenCalled();
		expect(onToggleWholeWord).not.toHaveBeenCalled();

		scope.stop();
	});

	it("handles uppercase key (Alt+C vs Alt+c)", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		fireKeydown("C");
		expect(onToggleCase).toHaveBeenCalledOnce();

		scope.stop();
	});

	it("cleanup removes event listeners on scope dispose", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		// Verify it works before dispose
		fireKeydown("c");
		expect(onToggleCase).toHaveBeenCalledOnce();

		// Dispose the scope
		scope.stop();

		// Should no longer respond to shortcuts
		fireKeydown("c");
		expect(onToggleCase).toHaveBeenCalledOnce(); // still 1, not 2
	});

	it("prevents default on matched shortcuts", () => {
		const isOpen = ref(true);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		const ev = fireKeydown("c");
		expect(ev.defaultPrevented).toBe(true);

		scope.stop();
	});

	it("responds dynamically when isOpen changes", () => {
		const isOpen = ref(false);
		const scope = effectScope();
		scope.run(() => {
			useSearchShortcuts(isOpen, { onToggleCase, onToggleRegex, onToggleWholeWord });
		});

		// Closed — no response
		fireKeydown("c");
		expect(onToggleCase).not.toHaveBeenCalled();

		// Open — should respond
		isOpen.value = true;
		fireKeydown("c");
		expect(onToggleCase).toHaveBeenCalledOnce();

		// Close again — no response
		isOpen.value = false;
		fireKeydown("c");
		expect(onToggleCase).toHaveBeenCalledOnce(); // still 1

		scope.stop();
	});
});
