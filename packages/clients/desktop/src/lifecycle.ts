export const CLOSE_BEHAVIOR_KEY = "termora.closeBehavior";

export type CloseBehavior = "ask" | "tray" | "quit";
export type CloseAction = "modal" | "hide" | "quit";

type CloseBehaviorStorage = Pick<Storage, "getItem" | "setItem">;

export interface ShutdownTarget {
	port: number;
	ownerToken: string | null;
	clientId?: string | null;
}

export interface QuitCompletelyDeps {
	fetch?: typeof fetch;
	getShutdownTarget?: () => Promise<ShutdownTarget | null>;
	confirmForce?: (others: number) => Promise<boolean>;
	exitApp?: () => Promise<void>;
	timeoutMs?: number;
}

export function normalizeCloseBehavior(value: unknown): CloseBehavior {
	return value === "tray" || value === "quit" || value === "ask" ? value : "ask";
}

export function readCloseBehavior(storage: CloseBehaviorStorage = localStorage): CloseBehavior {
	try {
		return normalizeCloseBehavior(storage.getItem(CLOSE_BEHAVIOR_KEY));
	} catch {
		return "ask";
	}
}

export function writeCloseBehavior(
	behavior: CloseBehavior,
	storage: CloseBehaviorStorage = localStorage,
): void {
	storage.setItem(CLOSE_BEHAVIOR_KEY, behavior);
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

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
	if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
		return AbortSignal.timeout(timeoutMs);
	}
	return undefined;
}

async function defaultShutdownTarget(): Promise<ShutdownTarget | null> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<ShutdownTarget>("get_hub_runtime");
}

async function defaultExitApp(): Promise<void> {
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("exit_app");
}

function othersFromBody(body: unknown): number {
	if (body && typeof body === "object" && "others" in body) {
		const others = (body as { others?: unknown }).others;
		if (typeof others === "number" && Number.isFinite(others) && others > 0) {
			return Math.floor(others);
		}
	}
	return 1;
}

async function requestShutdown(
	target: ShutdownTarget,
	force: boolean,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<Response> {
	const headers: Record<string, string> = {
		"X-Termora-Owner": target.ownerToken ?? "",
	};
	if (target.clientId) headers["X-Termora-Client-Id"] = target.clientId;
	const signal = timeoutSignal(timeoutMs);
	return fetchImpl(`http://localhost:${target.port}/api/shutdown${force ? "?force=1" : ""}`, {
		method: "POST",
		headers,
		...(signal ? { signal } : {}),
	});
}

export async function quitCompletely(
	deps: QuitCompletelyDeps = {},
): Promise<"exited" | "cancelled" | "failed"> {
	const fetchImpl = deps.fetch ?? fetch;
	const target = await (deps.getShutdownTarget ?? defaultShutdownTarget)();
	const exitApp = deps.exitApp ?? defaultExitApp;
	const confirmForce =
		deps.confirmForce ??
		((others: number) =>
			Promise.resolve(window.confirm(`${others} other client(s) are connected. Stop anyway?`)));
	const timeoutMs = deps.timeoutMs ?? 2_000;

	if (!target?.ownerToken) {
		await exitApp();
		return "exited";
	}

	try {
		const first = await requestShutdown(target, false, fetchImpl, timeoutMs);
		if (first.ok) {
			await exitApp();
			return "exited";
		}
		if (first.status !== 409) return "failed";

		const body = await first.json().catch(() => ({}));
		const others = othersFromBody(body);
		if (!(await confirmForce(others))) return "cancelled";

		try {
			const forced = await requestShutdown(target, true, fetchImpl, timeoutMs);
			if (!forced.ok) return "failed";
			await exitApp();
			return "exited";
		} catch {
			await exitApp();
			return "exited";
		}
	} catch {
		await exitApp();
		return "exited";
	}
}

export function shouldStartHubFromWebview(env: { DEV?: boolean } | undefined): boolean {
	return env?.DEV === true;
}
