import { Command } from "@tauri-apps/plugin-shell";

let hubProcess: Awaited<ReturnType<Command<string>["spawn"]>> | null = null;

/** Start the hub sidecar and wait for it to be ready. */
export async function startHub(port = 4100): Promise<void> {
	if (hubProcess) return; // Already running

	const command = Command.sidecar("termora-hub", ["--port", String(port)]);

	command.on("error", (error) => {
		console.error("[termora-desktop] hub error:", error);
		hubProcess = null;
	});

	command.on("close", (data) => {
		console.log("[termora-desktop] hub exited:", data.code);
		hubProcess = null;
	});

	command.stdout.on("data", (line) => {
		console.log("[hub]", line);
	});

	command.stderr.on("data", (line) => {
		console.error("[hub]", line);
	});

	hubProcess = await command.spawn();

	// Wait for hub to be ready (health check)
	await waitForHub(port);
}

/** Stop the hub sidecar gracefully. */
export async function stopHub(): Promise<void> {
	if (!hubProcess) return;
	await hubProcess.kill();
	hubProcess = null;
}

/** Poll the hub health endpoint until it responds. */
async function waitForHub(port: number, timeoutMs = 15000): Promise<void> {
	const start = Date.now();
	const url = `http://127.0.0.1:${port}/api/health`;

	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// Hub not ready yet
		}
		await new Promise((r) => setTimeout(r, 250));
	}

	throw new Error(`Hub did not become ready within ${timeoutMs}ms`);
}
