import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { encodeFrame, getSocketPath, parseAgentConfig } from "@nexterm/shared";
import type { AgentConfig, ProtocolMessage } from "@nexterm/shared";
import { DaemonServer } from "./daemon.js";
import { AgentHandler } from "./handler.js";

function parseArgs(): {
	mode: "stdio" | "daemon";
	config: AgentConfig;
} {
	const args = process.argv.slice(2);
	const mode = args.includes("--daemon") ? "daemon" : "stdio";

	const socketIdx = args.indexOf("--socket");
	const socketPath = socketIdx >= 0 ? args[socketIdx + 1] : undefined;

	const bpcIdx = args.indexOf("--buffer-per-channel");
	const bgIdx = args.indexOf("--buffer-global");

	const config = parseAgentConfig({
		...(socketPath !== undefined && { socket_path: socketPath }),
		...(bpcIdx >= 0 && args[bpcIdx + 1] !== undefined
			? { buffer_per_channel: Number(args[bpcIdx + 1]) }
			: {}),
		...(bgIdx >= 0 && args[bgIdx + 1] !== undefined
			? { buffer_global: Number(args[bgIdx + 1]) }
			: {}),
	});

	return { mode, config };
}

function getAgentStateDir(): string {
	if (process.platform === "win32") {
		return join(process.env.LOCALAPPDATA ?? "", "nexterm");
	}
	return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "nexterm");
}

function setupDaemonLogging(): void {
	const stateDir = getAgentStateDir();
	mkdirSync(stateDir, { recursive: true });
	const logPath = join(stateDir, "agent.log");
	const logStream = createWriteStream(logPath, { flags: "a" });

	const write = (data: string): void => {
		logStream.write(`${new Date().toISOString()} ${data}\n`);
	};

	console.log = (...args: unknown[]) => write(args.join(" "));
	console.error = (...args: unknown[]) => write(`[ERROR] ${args.join(" ")}`);
	console.warn = (...args: unknown[]) => write(`[WARN] ${args.join(" ")}`);
}

function startDaemon(config: AgentConfig): void {
	setupDaemonLogging();

	const socketPath = getSocketPath(config.socketPath);
	const server = new DaemonServer(socketPath, config);

	server.listen().catch((err) => {
		console.error("[nexterm-agent] failed to start daemon:", err);
		process.exit(1);
	});

	const shutdown = (): void => {
		server
			.shutdown()
			.then(() => process.exit(0))
			.catch(() => process.exit(1));
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

function startStdio(): void {
	// The agent speaks only via stdin/stdout (length-prefixed MessagePack).
	// All diagnostic output goes to stderr so it never corrupts the frame stream.

	// Backpressure: when stdout can't keep up (write returns false), pause
	// stdin so the hub stops sending frames. Resume on drain.
	let stdoutPaused = false;

	const handler = new AgentHandler((msg: ProtocolMessage) => {
		const frame = encodeFrame(msg);
		const ok = process.stdout.write(Buffer.from(frame));
		if (!ok && !stdoutPaused) {
			stdoutPaused = true;
			process.stdin.pause();
		}
	});

	process.stdout.on("drain", () => {
		if (stdoutPaused) {
			stdoutPaused = false;
			process.stdin.resume();
		}
	});

	// Announce ourselves immediately; hub will not send commands until it
	// receives HELLO.
	handler.sendHello();

	process.stdin.on("data", (data: Buffer) => {
		try {
			handler.onData(data);
		} catch (err) {
			console.error("[nexterm-agent] frame error:", err);
		}
	});

	process.stdin.on("end", () => {
		// Hub closed its end of the pipe — shut down cleanly.
		handler.shutdown();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		handler.shutdown();
		process.exit(0);
	});
}

function main(): void {
	const { mode, config } = parseArgs();

	if (mode === "daemon") {
		startDaemon(config);
		return;
	}

	startStdio();
}

main();
