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

export class DaemonServer {
	private handler: AgentHandler;
	private ptyManager: PtyManager;
	private buffer: OutputBuffer;
	private server: net.Server;
	private activeSocket: net.Socket | null = null;
	private socketPath: string;

	// Backpressure state
	private draining = false;
	private frameQueue: Buffer[] = [];
	private readonly maxQueueSize = 1000;

	constructor(socketPath: string, config: AgentConfig) {
		this.socketPath = socketPath;
		this.buffer = new OutputBuffer(config.bufferPerChannel, config.bufferGlobal);
		this.ptyManager = new PtyManager();

		// The send callback routes to active connection or buffer
		this.handler = new AgentHandler((msg) => this.routeMessage(msg), this.ptyManager);

		this.server = net.createServer((socket) => this.onConnection(socket));
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

		return new Promise((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.socketPath, () => {
				this.server.removeListener("error", reject);
				resolve();
			});
		});
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

		// Send HELLO
		this.handler.sendHello();

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
