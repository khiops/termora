export const CLOSE_BEHAVIOR_KEY = "termora.closeBehavior";

export const CLOSE_BEHAVIORS = ["ask", "tray", "quit"] as const;

export type CloseBehavior = (typeof CLOSE_BEHAVIORS)[number];
export type CloseAction = "modal" | "hide" | "quit";

type CloseBehaviorStorage = Pick<Storage, "getItem" | "setItem">;

function storageOrNull(storage?: CloseBehaviorStorage): CloseBehaviorStorage | null {
	if (storage) return storage;
	if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return null;
	return globalThis.localStorage;
}

export function isCloseBehavior(value: unknown): value is CloseBehavior {
	return value === "ask" || value === "tray" || value === "quit";
}

export function normalizeCloseBehavior(value: unknown): CloseBehavior {
	return isCloseBehavior(value) ? value : "ask";
}

export function readCloseBehavior(storage?: CloseBehaviorStorage): CloseBehavior {
	const resolvedStorage = storageOrNull(storage);
	if (!resolvedStorage) return "ask";
	try {
		return normalizeCloseBehavior(resolvedStorage.getItem(CLOSE_BEHAVIOR_KEY));
	} catch {
		return "ask";
	}
}

export function writeCloseBehavior(behavior: CloseBehavior, storage?: CloseBehaviorStorage): void {
	const resolvedStorage = storageOrNull(storage);
	if (!resolvedStorage) return;
	try {
		resolvedStorage.setItem(CLOSE_BEHAVIOR_KEY, behavior);
	} catch {
		// localStorage may be unavailable in hardened webviews.
	}
}

export function resolveCloseAction(behavior: unknown): CloseAction {
	switch (normalizeCloseBehavior(behavior)) {
		case "tray":
			return "hide";
		case "quit":
			return "quit";
		case "ask":
			return "modal";
	}
}
