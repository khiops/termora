import { defineStore } from "pinia";
import { ref } from "vue";

export interface ToastMessage {
	id: number;
	level: "error" | "warning" | "info";
	text: string;
}

let nextId = 1;

/**
 * Minimal in-app toast store.
 * Components can subscribe to `messages` and render them in a toast container.
 */
export const useToastStore = defineStore("toast", () => {
	const messages = ref<ToastMessage[]>([]);

	function show(level: ToastMessage["level"], text: string, durationMs = 5000): void {
		const id = nextId++;
		messages.value = [...messages.value, { id, level, text }];
		setTimeout(() => dismiss(id), durationMs);
	}

	function dismiss(id: number): void {
		messages.value = messages.value.filter((m) => m.id !== id);
	}

	return { messages, show, dismiss };
});
