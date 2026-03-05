import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import { AgentConnection } from "./agent-connection.js";

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
const SEND_QUEUE_WARN = 1000;

export class LocalAgent extends AgentConnection {
	private process: ChildProcess | null = null;
	private sendQueue: Buffer[] = [];
	private draining = false;

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

		this.process.stdin?.on("drain", () => {
			this.flushSendQueue();
		});

		this.process.on("close", (code) => {
			this.sendQueue.length = 0;
			this.draining = false;
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
		const frame = Buffer.from(encodeFrame(msg));
		if (this.draining) {
			this.enqueueSend(frame);
			return;
		}
		const ok = this.process.stdin.write(frame);
		if (!ok) {
			this.draining = true;
		}
	}

	/** Terminate the agent process with SIGTERM. */
	close(): void {
		this.sendQueue.length = 0;
		this.draining = false;
		if (this.process) {
			this.process.kill("SIGTERM");
			this.process = null;
		}
	}

	get connected(): boolean {
		return this.process !== null && !this.process.killed;
	}

	private enqueueSend(frame: Buffer): void {
		if (this.sendQueue.length >= SEND_QUEUE_WARN) {
			if (this.sendQueue.length === SEND_QUEUE_WARN) {
				console.warn(
					`[local-agent] send queue reached ${SEND_QUEUE_WARN} messages, dropping oldest`,
				);
			}
			this.sendQueue.shift();
		}
		this.sendQueue.push(frame);
	}

	private flushSendQueue(): void {
		this.draining = false;
		let frame = this.sendQueue.shift();
		while (frame && !this.draining) {
			const ok = this.process?.stdin?.write(frame) ?? false;
			if (!ok) {
				this.draining = true;
			}
			frame = this.draining ? undefined : this.sendQueue.shift();
		}
	}
}
