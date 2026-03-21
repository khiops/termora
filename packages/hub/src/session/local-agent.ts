import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import { detectSea } from "@nexterm/shared/dist/sea-addon-loader.js";
import { resolveAgentBinaryPath } from "../sea-agent-resolver.js";
import type { HubLogger } from "../logging/hub-logger.js";
import { AgentConnection } from "./agent-connection.js";
import { SendQueue } from "./send-queue.js";

const HELLO_TIMEOUT_MS = 5_000;

/**
 * Resolve the path to the agent entry point or binary.
 *
 * In SEA mode: looks for a co-located nexterm-agent binary next to the hub
 * executable. Falls back to PATH resolution via resolveAgentBinaryPath().
 *
 * In dev mode: returns the compiled JS entry point at
 *   ../../../agent/dist/main.js  (relative to this file)
 *
 * The returned path is a self-contained executable when running in SEA mode,
 * or a JS module path when running in dev mode.
 */
export function resolveAgentPath(): string {
	const sea = detectSea();
	// In SEA mode, look for co-located agent binary
	if (sea) {
		const seaPath = resolveAgentBinaryPath();
		console.log(`[local-agent] resolveAgentPath: SEA mode detected, resolveAgentBinaryPath=${seaPath}`);
		if (seaPath) return seaPath;
	}
	// Dev mode fallback
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const devPath = join(__dirname, "../../../agent/dist/main.js");
	console.log(`[local-agent] resolveAgentPath: sea=${sea} devPath=${devPath} process.execPath=${process.execPath}`);
	return devPath;
}

/**
 * Returns true if the given agent path is a self-contained executable
 * (i.e. a SEA binary) rather than a JS module file.
 */
export function isAgentBinary(agentPath: string): boolean {
	return !agentPath.endsWith(".js");
}

/**
 * LocalAgent spawns a nexterm agent as a child process and communicates via
 * length-prefixed MessagePack frames over stdin/stdout.
 *
 * Usage:
 *   const agent = new LocalAgent(resolveAgentPath());
 *   await agent.start();          // resolves after HELLO handshake
 *   agent.send({ type: "SPAWN", ... });
 *   agent.on("message", (msg) => { ... });
 *   agent.close();
 */
export class LocalAgent extends AgentConnection {
	private process: ChildProcess | null = null;
	private readonly sendQueue = new SendQueue("local-agent");
	private hubLogger: HubLogger | null = null;

	constructor(private readonly agentPath: string) {
		super();
	}

	/** Set the hub logger for routing agent stderr before a channel logger is available. */
	setHubLogger(logger: HubLogger): void {
		this.hubLogger = logger;
	}

	/**
	 * Spawn the agent process and wait for the HELLO handshake.
	 * Rejects with an error if HELLO is not received within 5 seconds.
	 *
	 * SEA mode: the agent path is a self-contained executable — spawn directly.
	 * Dev mode: the agent path is a JS file — spawn via node.
	 */
	async start(): Promise<void> {
		const isBinary = isAgentBinary(this.agentPath);
		const [cmd, args] = isBinary
			? [this.agentPath, ["--stdio"]]
			: [process.execPath, [this.agentPath, "--stdio"]];

		console.log(`[local-agent] start: agentPath=${this.agentPath} isBinary=${isBinary} cmd=${cmd} args=${JSON.stringify(args)}`);

		this.process = spawn(cmd, args, {
			stdio: ["pipe", "pipe", "pipe"], // stdin=pipe, stdout=pipe, stderr=pipe (capture for logging)
		});

		console.log(`[local-agent] start: process spawned pid=${this.process.pid}`);

		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleData(data);
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			const text = data.toString("utf-8").trimEnd();
			// Always route to hubLogger; the LOG protocol message is the proper
			// mechanism for channel-specific agent diagnostics.
			if (this.hubLogger) {
				this.hubLogger.log("info", text, { src: "agent" });
			} else {
				process.stderr.write(`[agent] ${text}\n`);
			}
		});

		if (this.process.stdin) {
			this.sendQueue.attach(this.process.stdin);
		}

		this.process.on("error", (err) => {
			console.log(`[local-agent] process error event: ${err instanceof Error ? err.stack : String(err)}`);
			this.emit("error", err);
		});

		this.process.on("exit", (code, signal) => {
			console.log(`[local-agent] process exit event: code=${code} signal=${signal}`);
		});

		this.process.on("close", (code) => {
			console.log(`[local-agent] process close event: code=${code}`);
			this.sendQueue.clear();
			this.process = null;
			this.emit("close", code);
		});

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				console.log(`[local-agent] start: HELLO timeout after ${HELLO_TIMEOUT_MS}ms — agent did not send HELLO`);
				reject(new Error("Agent HELLO timeout"));
			}, HELLO_TIMEOUT_MS);

			this.once("ready", () => {
				console.log(`[local-agent] start: HELLO received — agent ready`);
				clearTimeout(timeout);
				resolve();
			});
		});
	}

	/** Send a protocol message to the agent via its stdin (with backpressure). */
	send(msg: ProtocolMessage): void {
		if (!this.process?.stdin?.writable) {
			throw new Error("Agent not connected");
		}
		this.sendQueue.send(Buffer.from(encodeFrame(msg)));
	}

	/** Terminate the agent process with SIGTERM. */
	close(): void {
		this.sendQueue.clear();
		if (this.process) {
			this.process.kill("SIGTERM");
			this.process = null;
		}
	}

	get connected(): boolean {
		return this.process !== null && !this.process.killed;
	}
}
