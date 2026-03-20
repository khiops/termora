import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import { detectSea } from "@nexterm/shared/dist/sea-addon-loader.js";
import { resolveAgentBinaryPath } from "../sea-agent-resolver.js";
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
		if (seaPath) return seaPath;
	}
	// Dev mode fallback
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const devPath = join(__dirname, "../../../agent/dist/main.js");
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

	constructor(private readonly agentPath: string) {
		super();
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


		this.process = spawn(cmd, args, {
			stdio: ["pipe", "pipe", "pipe"], // stdin=pipe, stdout=pipe, stderr=pipe (capture for logging)
		});


		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleData(data);
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[agent] ${data.toString().trimEnd()}
`);
		});

		if (this.process.stdin) {
			this.sendQueue.attach(this.process.stdin);
		}

		this.process.on("error", (err) => {
			this.emit("error", err);
		});

		this.process.on("close", (code) => {
			this.sendQueue.clear();
			this.process = null;
			this.emit("close", code);
		});

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Agent HELLO timeout"));
			}, HELLO_TIMEOUT_MS);

			this.once("ready", () => {
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
