import { hubBaseUrl } from "./hub-url.js";

export interface ShutdownTarget {
	port: number;
	ownerToken: string | null;
	clientId?: string | null;
}

export type QuitOutcome =
	| { status: "exited" }
	| { status: "cancelled"; others: number }
	| { status: "failed"; error: Error };

export interface QuitCompletelyDeps {
	fetch?: typeof fetch;
	getShutdownTarget?: () => Promise<ShutdownTarget | null>;
	confirmForce?: (others: number) => Promise<boolean>;
	exitApp?: () => Promise<void>;
	timeoutMs?: number;
}

interface ShutdownResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
	if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
		return AbortSignal.timeout(timeoutMs);
	}
	return undefined;
}

async function readTauriShutdownTarget(): Promise<ShutdownTarget | null> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<ShutdownTarget>("get_hub_runtime");
}

async function defaultExitApp(): Promise<void> {
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("exit_app");
}

function shutdownUrl(port: number, force: boolean): string {
	const base = hubBaseUrl() || `http://localhost:${port}`;
	return `${base}/api/shutdown${force ? "?force=1" : ""}`;
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
): Promise<ShutdownResponse> {
	const headers: Record<string, string> = {
		"X-Termora-Owner": target.ownerToken ?? "",
	};
	if (target.clientId) {
		headers["X-Termora-Client-Id"] = target.clientId;
	}
	const signal = timeoutSignal(timeoutMs);

	return (await fetchImpl(shutdownUrl(target.port, force), {
		method: "POST",
		headers,
		...(signal ? { signal } : {}),
	})) as ShutdownResponse;
}

export async function quitCompletely(deps: QuitCompletelyDeps = {}): Promise<QuitOutcome> {
	const fetchImpl = deps.fetch ?? fetch;
	const getShutdownTarget = deps.getShutdownTarget ?? readTauriShutdownTarget;
	const confirmForce =
		deps.confirmForce ??
		((others: number) => Promise.resolve(window.confirm(forceShutdownMessage(others))));
	const exitApp = deps.exitApp ?? defaultExitApp;
	const timeoutMs = deps.timeoutMs ?? 2_000;
	const target = await getShutdownTarget();

	if (!target?.ownerToken) {
		await exitApp();
		return { status: "exited" };
	}

	try {
		const first = await requestShutdown(target, false, fetchImpl, timeoutMs);
		if (first.ok) {
			await exitApp();
			return { status: "exited" };
		}

		if (first.status === 409) {
			const body = await first.json().catch(() => ({}));
			const others = othersFromBody(body);
			const confirmed = await confirmForce(others);
			if (!confirmed) return { status: "cancelled", others };

			try {
				const forced = await requestShutdown(target, true, fetchImpl, timeoutMs);
				if (forced.ok) {
					await exitApp();
					return { status: "exited" };
				}
				return {
					status: "failed",
					error: new Error(`Shutdown failed with HTTP ${forced.status}`),
				};
			} catch {
				await exitApp();
				return { status: "exited" };
			}
		}

		return {
			status: "failed",
			error: new Error(`Shutdown failed with HTTP ${first.status}`),
		};
	} catch {
		await exitApp();
		return { status: "exited" };
	}
}

export function forceShutdownMessage(others: number): string {
	const suffix = others === 1 ? "client is" : "clients are";
	return `${others} other ${suffix} connected. Stop the hub anyway?`;
}
