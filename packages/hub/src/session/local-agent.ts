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
 * SEC-028: Strip ANSI escape sequences and other control characters from
 * agent stderr before logging to prevent log injection attacks.
 */
function sanitizeLogInput(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional sanitization
	return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

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
		// SEA mode: agent binary path resolved at startup, logged by caller if needed
		if (seaPath) return seaPath;
	}
	// Dev mode fallback
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const devPath = join(__dirname, "../../../agent/dist/main.js");
	// dev mode fallback: devPath resolved below
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

		this.hubLogger?.log("debug", "local-agent: spawning", { agentPath: this.agentPath, isBinary, cmd, args });

		this.process = spawn(cmd, args, {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			detached: process.platform === "win32", // DETACHED_PROCESS: no inherited console on Windows
		});

		this.hubLogger?.log("debug", "local-agent: process spawned", { pid: this.process.pid });

		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleData(data);
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			const text = data.toString("utf-8").trimEnd();
			// Always route to hubLogger; the LOG protocol message is the proper
			// mechanism for channel-specific agent diagnostics.
			const sanitized = sanitizeLogInput(text);
			if (this.hubLogger) {
				this.hubLogger.log("info", sanitized, { src: "agent" });
			} else {
				process.stderr.write(`[agent] ${sanitized}
`);
			}
		});

		if (this.process.stdin) {
			this.sendQueue.attach(this.process.stdin);
		}

		this.process.on("error", (err) => {
			this.hubLogger?.log("error", "local-agent: process error", { err: err instanceof Error ? err.stack : String(err) });
			this.emit("error", err);
		});

		this.process.on("exit", (code, signal) => {
			this.hubLogger?.log("debug", "local-agent: process exit", { code, signal });
		});

		this.process.on("close", (code) => {
			this.hubLogger?.log("debug", "local-agent: process close", { code });
			this.sendQueue.clear();
			this.process = null;
			this.emit("close", code);
		});

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.hubLogger?.log("error", "local-agent: HELLO timeout — agent did not send HELLO", { timeoutMs: HELLO_TIMEOUT_MS });
				reject(new Error("Agent HELLO timeout"));
			}, HELLO_TIMEOUT_MS);

			this.once("ready", () => {
				this.hubLogger?.log("debug", "local-agent: HELLO received — agent ready");
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
