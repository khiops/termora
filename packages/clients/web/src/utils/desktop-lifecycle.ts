export type QuitOutcome =
	| { status: "exited" }
	| { status: "cancelled"; others: number }
	| { status: "failed"; error: Error };

export type StopHubResult =
	| { status: "stopped"; others?: never }
	| { status: "conflict"; others?: number };

export interface QuitCompletelyDeps {
	stopHub?: (force: boolean) => Promise<StopHubResult>;
	confirmForce?: (others: number) => Promise<boolean>;
	exitApp?: () => Promise<void>;
}

async function defaultExitApp(): Promise<void> {
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("exit_app");
}

async function defaultStopHub(force: boolean): Promise<StopHubResult> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<StopHubResult>("stop_hub", { force });
}

export async function quitCompletely(deps: QuitCompletelyDeps = {}): Promise<QuitOutcome> {
	const stopHub = deps.stopHub ?? defaultStopHub;
	const confirmForce =
		deps.confirmForce ??
		((others: number) => Promise.resolve(window.confirm(forceShutdownMessage(others))));
	const exitApp = deps.exitApp ?? defaultExitApp;

	try {
		const first = await stopHub(false);
		if (first.status === "stopped") {
			await exitApp();
			return { status: "exited" };
		}

		if (first.status === "conflict") {
			const others = normalizeOthers(first.others);
			if (!(await confirmForce(others))) return { status: "cancelled", others };

			const forced = await stopHub(true);
			if (forced.status === "stopped") {
				await exitApp();
				return { status: "exited" };
			}
			return {
				status: "failed",
				error: new Error("The hub still reports other connected clients."),
			};
		}

		return {
			status: "failed",
			error: new Error("Unexpected native shutdown response"),
		};
	} catch (error) {
		return {
			status: "failed",
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

function normalizeOthers(others: unknown): number {
	if (typeof others === "number" && Number.isFinite(others) && others > 0) {
		return Math.floor(others);
	}
	console.warn("[desktop] native shutdown conflict response missing others count", { others });
	return 1;
}

export function forceShutdownMessage(others: number): string {
	const suffix = others === 1 ? "client is" : "clients are";
	return `${others} other ${suffix} connected. Stop the hub anyway?`;
}
