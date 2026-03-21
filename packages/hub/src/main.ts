import { mkdirSync } from "node:fs";
import path from "node:path";
import { initAuth } from "./auth.js";
import { deleteRuntime, getConfigDir, getStateDir, persistRuntime } from "./cli.js";
import { ConfigResolver } from "./config.js";
import { HubLogger } from "./logging/hub-logger.js";
import { runLogGc } from "./logging/log-gc.js";
import { openBrowser } from "./open-browser.js";
import { createServer, startServer } from "./server.js";
import { openDatabases } from "./storage/db.js";

async function main() {
	const port = Number(process.env.NEXTERM_PORT) || 4100;

	const configDir = getConfigDir();
	const stateDir = getStateDir();
	mkdirSync(configDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });

	// Ensure logs directory structure exists before creating HubLogger
	const logsDir = path.join(stateDir, "logs");
	mkdirSync(path.join(logsDir, "channels"), { recursive: true });

	// Load config.toml before creating HubLogger so logging config (level, output, etc.)
	// is respected from the start. ConfigResolver.loadFromFile() silently no-ops if the
	// file is absent, so this is always safe to call here.
	const earlyConfigResolver = new ConfigResolver(null as never);
	earlyConfigResolver.loadFromFile(configDir);

	// Initialize hub logger with config from config.toml (falls back to defaults if missing)
	const hubLogger = new HubLogger(logsDir, earlyConfigResolver.logConfig);

	const authToken = initAuth(configDir);
	const dbManager = openDatabases(stateDir);

	const server = await createServer({ port, authToken, dbManager, hubLogger, logsDir });
	const address = await startServer(server, { port });

	// Extract the actual port from the listen address (may differ from
	// requested port due to zero_conf auto-increment on EADDRINUSE).
	const actualPort = new URL(address).port ? Number(new URL(address).port) : port;

	persistRuntime({ pid: process.pid, port: actualPort, started_at: new Date().toISOString() });

	hubLogger.log("info", "hub started", { port: actualPort });
	console.log(`nexterm hub listening on ${address}`);
	console.log(`Auth token in: ${configDir}/auth.json`);

	// Run log GC after startup — active channels are recent enough to not be GC'd
	// (maxAgeDays=30 by default; any live channel log was created in this session).
	// PRE-04: GC runs with empty active set on fresh start (safe — no daemon
	// reattach on hub startup yet). When daemon reattach is implemented,
	// populate activeChannelIds from ctx.channels before running GC.
	runLogGc(logsDir, earlyConfigResolver.logConfig.maxAgeDays, new Set<string>()).catch((err) => {
		console.warn("[main] log GC failed:", err);
	});

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
