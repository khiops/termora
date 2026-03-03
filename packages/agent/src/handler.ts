import {
	FrameReader,
	OUTPUT_BATCH_BYTES,
	OUTPUT_BATCH_MS,
	PROTOCOL_VERSION,
} from "@nexterm/shared";
import type {
	AgentSpawnMessage,
	DestroyMessage,
	HeartbeatMessage,
	InputMessage,
	ProtocolMessage,
	ResizeMessage,
} from "@nexterm/shared";
import { PtyManager } from "./pty.js";

export class AgentHandler {
	private reader = new FrameReader();
	private ptyManager: PtyManager;

	constructor(
		private readonly sendMessage: (msg: ProtocolMessage) => void,
		ptyManager?: PtyManager,
	) {
		// Accept an injected PtyManager for testing; default to real one.
		this.ptyManager = ptyManager ?? new PtyManager();
	}

	/** Called when raw bytes arrive from the hub (stdin). */
	onData(data: Buffer): void {
		const messages = this.reader.push(data);
		for (const msg of messages) {
			this.dispatch(msg);
		}
	}

	/** Send HELLO immediately after the agent starts. */
	sendHello(): void {
		this.sendMessage({
			type: "HELLO",
			version: PROTOCOL_VERSION,
			agentVersion: "0.1.0",
			// "snapshot" capability added in M3 when xterm headless is integrated
			capabilities: ["multiplex", "resize"],
		});
	}

	/** Tear down all active PTY channels (called on SIGTERM / stdin EOF). */
	shutdown(): void {
		this.ptyManager.destroyAll();
	}

	// -------------------------------------------------------------------------
	// Private — message dispatch
	// -------------------------------------------------------------------------

	private dispatch(msg: ProtocolMessage): void {
		switch (msg.type) {
			case "SPAWN":
				// Both AgentSpawnMessage and UiSpawnMessage share type:"SPAWN".
				// The agent only ever receives AgentSpawnMessage from the hub, so cast.
				this.handleSpawn(msg as AgentSpawnMessage);
				break;
			case "INPUT":
				this.handleInput(msg);
				break;
			case "RESIZE":
				this.handleResize(msg);
				break;
			case "DESTROY":
				this.handleDestroy(msg);
				break;
			case "HEARTBEAT":
				this.handleHeartbeat(msg);
				break;
			// SNAPSHOT_REQ and ATTACH are handled in M3
			default:
				this.sendMessage({
					type: "ERROR",
					code: "INVALID_MESSAGE",
					message: `Unknown message type: ${(msg as ProtocolMessage & { type: string }).type}`,
				});
		}
	}

	private handleSpawn(msg: AgentSpawnMessage): void {
		try {
			const channelId = this.ptyManager.spawn({
				shell: msg.shell,
				cwd: msg.cwd,
				env: msg.env,
				cols: msg.cols,
				rows: msg.rows,
			});

			this.setupOutputBatching(channelId);

			this.ptyManager.onExit(channelId, (exit) => {
				const exitMsg: ProtocolMessage =
					exit.signal !== undefined
						? {
								type: "CHANNEL_EXIT",
								channelId,
								exitCode: exit.exitCode,
								signal: `SIG${exit.signal}`,
							}
						: { type: "CHANNEL_EXIT", channelId, exitCode: exit.exitCode };
				this.sendMessage(exitMsg);
				// Remove the channel from the manager after exit
				this.ptyManager.destroy(channelId);
			});

			this.sendMessage({
				type: "SPAWN_OK",
				requestId: msg.requestId,
				channelId,
			});
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			let code = "PTY_SPAWN_FAILED";
			if (error.message.includes("not found") || error.message.includes("ENOENT")) {
				code = "SHELL_NOT_FOUND";
			} else if (error.message.includes("permission") || error.message.includes("EACCES")) {
				code = "PERMISSION_DENIED";
			}
			this.sendMessage({
				type: "SPAWN_ERR",
				requestId: msg.requestId,
				code,
				message: error.message,
			});
		}
	}

	/**
	 * Buffer PTY output and flush either every OUTPUT_BATCH_MS milliseconds
	 * or every OUTPUT_BATCH_BYTES bytes, whichever threshold is reached first.
	 */
	private setupOutputBatching(channelId: string): void {
		let buffer: Buffer[] = [];
		let bufferSize = 0;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const flush = (): void => {
			if (buffer.length === 0) return;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}

			const data = Buffer.concat(buffer);
			buffer = [];
			bufferSize = 0;

			const seq = this.ptyManager.nextSeq(channelId);
			this.sendMessage({
				type: "OUTPUT",
				channelId,
				seq,
				ts: new Date().toISOString(),
				data: new Uint8Array(data),
			});
		};

		this.ptyManager.onData(channelId, (rawData: string) => {
			// node-pty delivers string; convert back to bytes preserving all values
			const chunk = Buffer.from(rawData, "binary");
			buffer.push(chunk);
			bufferSize += chunk.length;

			if (bufferSize >= OUTPUT_BATCH_BYTES) {
				flush();
			} else if (timer === null) {
				timer = setTimeout(flush, OUTPUT_BATCH_MS);
			}
		});
	}

	private handleInput(msg: InputMessage): void {
		if (!this.ptyManager.has(msg.channelId)) {
			this.sendMessage({
				type: "ERROR",
				code: "CHANNEL_NOT_FOUND",
				message: `Channel not found: ${msg.channelId}`,
				channelId: msg.channelId,
			});
			return;
		}
		this.ptyManager.write(msg.channelId, msg.data);
	}

	private handleResize(msg: ResizeMessage): void {
		// Silent ignore when the channel is gone (race with PTY exit)
		if (!this.ptyManager.has(msg.channelId)) return;
		this.ptyManager.resize(msg.channelId, msg.cols, msg.rows);
	}

	private handleDestroy(msg: DestroyMessage): void {
		this.ptyManager.destroy(msg.channelId);
	}

	private handleHeartbeat(msg: HeartbeatMessage): void {
		this.sendMessage({ type: "HEARTBEAT_ACK", ts: msg.ts });
	}
}
