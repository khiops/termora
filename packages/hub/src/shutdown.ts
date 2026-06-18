import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseManager } from "./storage/db.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

let shutdownPromise: Promise<void> | null = null;

export interface GracefulShutdownOptions {
	readonly server: Pick<FastifyInstance, "close" | "log">;
	readonly dbManager: Pick<DatabaseManager, "close">;
	readonly deleteRuntime: () => void;
	readonly exit?: (code: number) => void;
	readonly timeoutMs?: number;
	readonly setTimeout?: typeof setTimeout;
	readonly clearTimeout?: typeof clearTimeout;
}

class ShutdownTimeoutError extends Error {
	constructor(readonly phase: string) {
		super(`Shutdown timed out during ${phase}`);
		this.name = "ShutdownTimeoutError";
	}
}

export function createOwnerToken(): string {
	return randomBytes(32).toString("hex");
}

export function resetGracefulShutdownForTests(): void {
	shutdownPromise = null;
}

export function gracefulShutdown(options: GracefulShutdownOptions): Promise<void> {
	if (shutdownPromise) return shutdownPromise;

	shutdownPromise = runGracefulShutdown(options);
	return shutdownPromise;
}

async function runGracefulShutdown(options: GracefulShutdownOptions): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
	const setTimeoutFn = options.setTimeout ?? setTimeout;
	const clearTimeoutFn = options.clearTimeout ?? clearTimeout;
	const exit = options.exit ?? ((code: number) => process.exit(code));

	let phase = "server.close";
	let runtimeDeleted = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const teardown = (async () => {
		phase = "server.close";
		await options.server.close();

		phase = "db.close";
		options.dbManager.close();

		phase = "runtime.delete";
		options.deleteRuntime();
		runtimeDeleted = true;

		phase = "exit";
		exit(0);
	})();

	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = setTimeoutFn(() => {
			reject(new ShutdownTimeoutError(phase));
		}, timeoutMs);
	});

	try {
		await Promise.race([teardown, timeout]);
	} catch (err) {
		const timedOut = err instanceof ShutdownTimeoutError;
		options.server.log?.error(
			{
				err,
				phase: timedOut ? err.phase : phase,
			},
			timedOut ? "graceful shutdown timed out" : "graceful shutdown failed",
		);
		if (!runtimeDeleted) {
			try {
				options.deleteRuntime();
				runtimeDeleted = true;
			} catch (deleteErr) {
				options.server.log?.error({ err: deleteErr }, "failed to delete runtime.json");
			}
		}
		exit(1);
	} finally {
		if (timeoutId !== undefined) clearTimeoutFn(timeoutId);
	}
}
