import type { Ref } from "vue";
import { onScopeDispose } from "vue";

/**
 * Keyboard shortcuts for search toggles.
 *
 * Listens for Alt+C (case), Alt+R (regex), Alt+W (whole word)
 * on the document while the search overlay is open.
 * Automatically cleans up via onScopeDispose.
 */
export function useSearchShortcuts(
	isOpen: Ref<boolean>,
	callbacks: {
		onToggleCase: () => void;
		onToggleRegex: () => void;
		onToggleWholeWord: () => void;
	},
): void {
	function handleKeydown(ev: KeyboardEvent): void {
		if (!isOpen.value) return;
		if (!ev.altKey) return;

		switch (ev.key.toLowerCase()) {
			case "c":
				ev.preventDefault();
				callbacks.onToggleCase();
				break;
			case "r":
				ev.preventDefault();
				callbacks.onToggleRegex();
				break;
			case "w":
				ev.preventDefault();
				callbacks.onToggleWholeWord();
				break;
		}
	}

	document.addEventListener("keydown", handleKeydown);

	onScopeDispose(() => {
		document.removeEventListener("keydown", handleKeydown);
	});
}
