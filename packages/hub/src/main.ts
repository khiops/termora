import { mkdirSync } from "node:fs";
import { initAuth } from "./auth.js";
import { deleteRuntime, getConfigDir, getStateDir, persistRuntime } from "./cli.js";
import { openBrowser } from "./open-browser.js";
import { createServer, startServer } from "./server.js";
import { openDatabases } from "./storage/db.js";

async function main() {
	const port = Number(process.env.NEXTERM_PORT) || 4100;

	const configDir = getConfigDir();
	const stateDir = getStateDir();
	mkdirSync(configDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });

	const authToken = initAuth(configDir);
	const dbManager = openDatabases(stateDir);

	const server = await createServer({ port, authToken, dbManager });
	const address = await startServer(server, { port });

	// Extract the actual port from the listen address (may differ from
	// requested port due to zero_conf auto-increment on EADDRINUSE).
	const actualPort = new URL(address).port ? Number(new URL(address).port) : port;

	persistRuntime({ pid: process.pid, port: actualPort, started_at: new Date().toISOString() });

	console.log(`nexterm hub listening on ${address}`);
	console.log(`Auth token in: ${configDir}/auth.json`);

	// Open browser if requested via NEXTERM_OPEN env (set by CLI daemon spawner)
	if (process.env.NEXTERM_OPEN === "1") {
		openBrowser(`http://127.0.0.1:${actualPort}`);
	}

	const shutdown = async () => {
		deleteRuntime();
		dbManager.close();
		await server.close();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error("Failed to start hub:", err);
	process.exit(1);
});
