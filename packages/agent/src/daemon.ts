import { mkdir, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { FrameReader, encodeFrame } from "@nexterm/shared";
import type {
	AgentChannelStateMessage,
	AgentConfig,
	ChannelStateEndMessage,
	OutputMessage,
	ProtocolMessage,
} from "@nexterm/shared";
import { OutputBuffer } from "./buffer.js";
import { AgentHandler } from "./handler.js";
import { PtyManager } from "./pty.js";

/** Maximum safe Unix socket path length (platform limit is 104-108 bytes) */
const MAX_SOCKET_PATH_LENGTH = 100;

/** Maximum EADDRINUSE retry attempts before giving up */
const BIND_RETRY_MAX = 3;

/** Returns a random integer in [min, max) */
function randomIntBetween(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min)) + min;
}

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DaemonServer {
	private handler: AgentHandler;
	private ptyManager: PtyManager;
	private buffer: OutputBuffer;
	private server: net.Server;
	private activeSocket: net.Socket | null = null;
	private socketPath: string;
	private bindTimeout: number;

	// Backpressure state
	private draining = false;
	private frameQueue: Buffer[] = [];
	private readonly maxQueueSize = 1000;

	constructor(socketPath: string, config: AgentConfig) {
		// Item 2: Validate socket path length before any I/O.
		// Most platforms enforce a limit of 104-108 bytes; use 100 as a safe upper bound.
		if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_LENGTH) {
			throw new Error(
				`Unix socket path is too long (${Buffer.byteLength(socketPath)} bytes, max ${MAX_SOCKET_PATH_LENGTH}). Set a shorter XDG_STATE_HOME or socket_path in config.toml.`,
			);
		}

		this.socketPath = socketPath;
		// Item 3: Store configurable bind timeout (default 5000ms).
		this.bindTimeout = config.bindTimeout;
		this.buffer = new OutputBuffer(config.bufferPerChannel, config.bufferGlobal);
		this.ptyManager = new PtyManager();

		// The send callback routes to active connection or buffer
		this.handler = new AgentHandler((msg) => this.routeMessage(msg), this.ptyManager);

		this.server = net.createServer((socket) => this.onConnection(socket));
	}

	/** Attempt a single net.Server.listen(), resolving on success or rejecting on error. */
	private bindOnce(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Item 3: Enforce configurable bind timeout.
			const timer = setTimeout(() => {
				this.server.removeAllListeners("error");
				reject(new Error(`Socket bind timed out after ${this.bindTimeout}ms: ${this.socketPath}`));
			}, this.bindTimeout);

			this.server.once("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});

			this.server.listen(this.socketPath, () => {
				clearTimeout(timer);
				this.server.removeAllListeners("error");
				resolve();
			});
		});
	}

	/** Start listening on the socket path. Creates runtime directory if needed. */
	async listen(): Promise<void> {
		// Ensure parent directory exists with 0700 permissions
		const dir = path.dirname(this.socketPath);
		await mkdir(dir, { recursive: true, mode: 0o700 });

		// Remove stale socket file if it exists (e.g., after unclean shutdown)
		if (process.platform !== "win32") {
			try {
				await unlink(this.socketPath);
			} catch {
				// ENOENT is expected — file doesn't exist
			}
		}

		// Item 1: Retry up to BIND_RETRY_MAX times on EADDRINUSE with randomized backoff.
		let lastError: unknown;
		for (let attempt = 1; attempt <= BIND_RETRY_MAX; attempt++) {
			try {
				await this.bindOnce();
				return;
			} catch (err) {
				const nodeErr = err as NodeJS.ErrnoException;
				if (nodeErr.code !== "EADDRINUSE" || attempt === BIND_RETRY_MAX) {
					throw err;
				}
				lastError = err;
				const delayMs = randomIntBetween(100, 501);
				console.error(
					`[nexterm-agent] EADDRINUSE on ${this.socketPath} — retry ${attempt}/${BIND_RETRY_MAX - 1} in ${delayMs}ms`,
				);
				await sleep(delayMs);
				// Remove stale error/listen listeners so the next bindOnce() starts clean.
				this.server.removeAllListeners("error");
				this.server.removeAllListeners("listening");
			}
		}
		throw lastError;
	}

	/** Graceful shutdown: close all PTYs, close server, unlink socket. */
	async shutdown(): Promise<void> {
		this.handler.shutdown();
		this.buffer.clear();

		if (this.activeSocket) {
			this.activeSocket.destroy();
			this.activeSocket = null;
		}

		await new Promise<void>((resolve) => {
			this.server.close(() => resolve());
		});

		// Remove socket file (Unix only, named pipes clean up automatically)
		if (process.platform !== "win32") {
			try {
				await unlink(this.socketPath);
			} catch {
				// Already removed or never created
			}
		}
	}

	private onConnection(socket: net.Socket): void {
		// Displace previous connection (last-writer-wins)
		if (this.activeSocket) {
			this.activeSocket.destroy();
		}

		this.activeSocket = socket;
		this.draining = false;
		this.frameQueue.length = 0;

		// Per-connection FrameReader (fresh for each connection)
		const reader = new FrameReader();

		socket.on("data", (data: Buffer) => {
			try {
				const messages = reader.push(data);
				for (const msg of messages) {
					this.handler.handleMessage(msg);
				}
			} catch (err) {
				console.error("[nexterm-agent] frame error:", err);
			}
		});

		socket.on("close", () => {
			if (this.activeSocket === socket) {
				this.activeSocket = null;
				this.draining = false;
				this.frameQueue.length = 0;
			}
		});

		socket.on("error", (err) => {
			console.error("[nexterm-agent] socket error:", err);
		});

		socket.on("drain", () => {
			if (this.activeSocket === socket) {
				this.draining = false;
				this.flushFrameQueue();
			}
		});

		// Send HELLO (async: shell detection), then send channel state messages
		// in order. CHANNEL_STATE_END must follow HELLO so the hub's
		// waitForChannelState() sees them in the right sequence.
		this.handler
			.sendHello()
			.then(() => {
				// Send AGENT_CHANNEL_STATE for each alive channel
				const channels = this.ptyManager.getChannels();
				for (const ch of channels) {
					const stateMsg: AgentChannelStateMessage = {
						type: "AGENT_CHANNEL_STATE",
						channelId: ch.id,
						title: ch.title,
						pid: ch.pid,
						alive: true,
					};
					this.routeMessage(stateMsg);
				}

				// Send CHANNEL_STATE_END sentinel
				const endMsg: ChannelStateEndMessage = { type: "CHANNEL_STATE_END" };
				this.routeMessage(endMsg);

				// Flush any buffered output from previous disconnect
				this.flushOutputBuffer();
			})
			.catch((err: unknown) => {
				console.error("[nexterm-agent] sendHello failed:", err);
			});
	}

	private routeMessage(msg: ProtocolMessage): void {
		if (this.activeSocket && !this.activeSocket.destroyed) {
			const frame = Buffer.from(encodeFrame(msg));
			this.sendFrame(frame);
		} else if (msg.type === "OUTPUT") {
			// Buffer OUTPUT when disconnected
			const outputMsg = msg as OutputMessage;
			this.buffer.write(outputMsg.channelId, outputMsg.data);
		}
		// Other message types are dropped when disconnected
		// (hub discovers state via AGENT_CHANNEL_STATE on reconnect)
	}

	private sendFrame(frame: Buffer): void {
		if (!this.activeSocket || this.activeSocket.destroyed) return;

		if (this.draining) {
			if (this.frameQueue.length >= this.maxQueueSize) {
				this.frameQueue.shift(); // drop oldest
			}
			this.frameQueue.push(frame);
			return;
		}

		const ok = this.activeSocket.write(frame);
		if (!ok) {
			this.draining = true;
		}
	}

	private flushFrameQueue(): void {
		while (this.frameQueue.length > 0) {
			if (!this.activeSocket || this.activeSocket.destroyed) break;
			const frame = this.frameQueue.shift();
			if (!frame) break;
			const ok = this.activeSocket.write(frame);
			if (!ok) {
				this.draining = true;
				return;
			}
		}
	}

	private flushOutputBuffer(): void {
		const buffered = this.buffer.drainAll();
		for (const [channelId, data] of buffered) {
			if (!this.ptyManager.has(channelId)) continue;
			const seq = this.ptyManager.nextSeq(channelId);
			this.routeMessage({
				type: "OUTPUT",
				channelId,
				seq,
				ts: new Date().toISOString(),
				data: new Uint8Array(data),
			});
		}
	}
}
