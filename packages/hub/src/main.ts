import { createServer, startServer } from "./server.js";

async function main() {
	const server = await createServer();
	const address = await startServer(server);
	console.log(`nexterm hub listening on ${address}`);

	// Graceful shutdown
	const shutdown = async () => {
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
