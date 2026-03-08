import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import { AgentConnection } from "./agent-connection.js";
import { SendQueue } from "./send-queue.js";

const HELLO_TIMEOUT_MS = 5_000;

/**
 * Resolve the path to the compiled agent entry point.
 *
 * Layout (relative to this file at packages/hub/src/session/):
 *   ../../../agent/dist/main.js
 *
 * In development the agent must be built first (`pnpm build` or
 * `pnpm -F @nexterm/agent build`).
 */
export function resolveAgentPath(): string {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	return join(__dirname, "../../../agent/dist/main.js");
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
	 */
	async start(): Promise<void> {
		this.process = spawn(process.execPath, [this.agentPath, "--stdio"], {
			stdio: ["pipe", "pipe", "inherit"], // stdin=pipe, stdout=pipe, stderr=inherit (logs)
		});

		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleData(data);
		});

		if (this.process.stdin) {
			this.sendQueue.attach(this.process.stdin);
		}

		this.process.on("close", (code) => {
			this.sendQueue.clear();
			this.process = null;
			this.emit("close", code);
		});

		this.process.on("error", (err) => {
			this.emit("error", err);
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
