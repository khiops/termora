import {
	FrameReader,
	OUTPUT_BATCH_BYTES,
	OUTPUT_BATCH_MS,
	PROTOCOL_VERSION,
	sanitizeTitle,
} from "@nexterm/shared";
import type {
	AgentAttachMessage,
	AgentSpawnMessage,
	DestroyMessage,
	HeartbeatMessage,
	InputMessage,
	ProtocolMessage,
	ResizeMessage,
	SnapshotReqMessage,
} from "@nexterm/shared";
import { PtyManager } from "./pty.js";

const SIGNAL_NAMES: Record<number, string> = {
	1: "SIGHUP",
	2: "SIGINT",
	3: "SIGQUIT",
	6: "SIGABRT",
	9: "SIGKILL",
	11: "SIGSEGV",
	13: "SIGPIPE",
	14: "SIGALRM",
	15: "SIGTERM",
};

const TITLE_DEBOUNCE_MS = 100;
const BELL_THROTTLE_MS = 100;
const OSC9_THROTTLE_MS = 500;
const OSC9_MAX_LENGTH = 256;
/** Matches C0 (except \n), DEL, and C1 control characters for OSC 9 sanitization. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping terminal control chars while preserving newlines
const OSC9_CONTROL_CHARS_RE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

export class AgentHandler {
	private reader = new FrameReader();
	private ptyManager: PtyManager;
	private titleDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private lastBellTimestamps = new Map<string, number>();
	private lastOsc9Timestamps = new Map<string, number>();

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
			capabilities: ["multiplex", "resize", "snapshot"],
		});
	}

	/** Handle a pre-parsed protocol message (used by DaemonServer with per-connection FrameReader). */
	handleMessage(msg: ProtocolMessage): void {
		this.dispatch(msg);
	}

	/** Tear down all active PTY channels (called on SIGTERM / stdin EOF). */
	shutdown(): void {
		for (const timer of this.titleDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.titleDebounceTimers.clear();
		this.lastBellTimestamps.clear();
		this.lastOsc9Timestamps.clear();
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
			case "SNAPSHOT_REQ":
				this.handleSnapshotReq(msg as SnapshotReqMessage);
				break;
			case "ATTACH":
				this.handleAttach(msg as AgentAttachMessage);
				break;
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
				...(msg.channelId !== undefined && { id: msg.channelId }),
				shell: msg.shell,
				...(msg.args !== undefined && msg.args.length > 0 && { args: msg.args }),
				cwd: msg.cwd,
				env: msg.env,
				cols: msg.cols,
				rows: msg.rows,
			});

			this.setupOutputBatching(channelId);
			this.setupTitleChangeHandler(channelId);
			this.setupBellHandler(channelId);
			this.setupOsc9Handler(channelId);

			this.ptyManager.onExit(channelId, (exit) => {
				this.clearTitleDebounce(channelId);
				const exitMsg: ProtocolMessage =
					exit.signal !== undefined
						? {
								type: "CHANNEL_EXIT",
								channelId,
								exitCode: exit.exitCode,
								signal: SIGNAL_NAMES[exit.signal] ?? `SIG${exit.signal}`,
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
			// Channel may have been destroyed while flush was pending
			if (!this.ptyManager.has(channelId)) {
				buffer = [];
				bufferSize = 0;
				return;
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
			if (!this.ptyManager.has(channelId)) return;
			// node-pty delivers UTF-8 string; re-encode to bytes
			const chunk = Buffer.from(rawData);
			buffer.push(chunk);
			bufferSize += chunk.length;

			if (bufferSize >= OUTPUT_BATCH_BYTES) {
				flush();
			} else if (timer === null) {
				timer = setTimeout(flush, OUTPUT_BATCH_MS);
			}
		});
	}

	private clearTitleDebounce(channelId: string): void {
		const timer = this.titleDebounceTimers.get(channelId);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.titleDebounceTimers.delete(channelId);
		}
	}

	/**
	 * Debounce terminal title changes (OSC 0/2) per channel.
	 * Fires TITLE_CHANGE at most once every TITLE_DEBOUNCE_MS per channel
	 * (last-write-wins).
	 */
	private setupTitleChangeHandler(channelId: string): void {
		this.ptyManager.onTitleChange(channelId, (rawTitle: string) => {
			if (!this.ptyManager.has(channelId)) return;
			const title = sanitizeTitle(rawTitle);
			if (title === "") return;

			const existing = this.titleDebounceTimers.get(channelId);
			if (existing !== undefined) {
				clearTimeout(existing);
			}
			this.titleDebounceTimers.set(
				channelId,
				setTimeout(() => {
					this.titleDebounceTimers.delete(channelId);
					if (!this.ptyManager.has(channelId)) return;
					this.sendMessage({
						type: "TITLE_CHANGE",
						channelId,
						title,
					});
				}, TITLE_DEBOUNCE_MS),
			);
		});
	}

	/**
	 * Throttle bell events per channel: max 1 BELL per BELL_THROTTLE_MS.
	 * Uses a simple timestamp comparison (not debounce — first-write-wins).
	 */
	private setupBellHandler(channelId: string): void {
		this.ptyManager.onBell(channelId, () => {
			if (!this.ptyManager.has(channelId)) return;

			const now = Date.now();
			const last = this.lastBellTimestamps.get(channelId) ?? 0;
			if (now - last < BELL_THROTTLE_MS) return;

			this.lastBellTimestamps.set(channelId, now);
			this.sendMessage({ type: "BELL", channelId });
		});
	}

	/**
	 * Throttle OSC 9 notifications per channel: max 1 NOTIFICATION per OSC9_THROTTLE_MS.
	 * Sanitizes the message: strips control chars (except \n), strips HTML tags,
	 * truncates to OSC9_MAX_LENGTH, and trims whitespace.
	 */
	private setupOsc9Handler(channelId: string): void {
		this.ptyManager.onOsc9(channelId, (rawMessage: string): boolean => {
			if (!this.ptyManager.has(channelId)) return true;

			const now = Date.now();
			const last = this.lastOsc9Timestamps.get(channelId) ?? 0;
			if (now - last < OSC9_THROTTLE_MS) return true;

			// Sanitize: strip HTML tags, strip control chars (keep \n), truncate, trim
			const message = rawMessage
				.replace(/<[^>]*>/g, "")
				.replace(OSC9_CONTROL_CHARS_RE, "")
				.trim()
				.slice(0, OSC9_MAX_LENGTH);

			if (message === "") return true;

			this.lastOsc9Timestamps.set(channelId, now);
			this.sendMessage({ type: "NOTIFICATION", channelId, message });
			return true;
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
		this.clearTitleDebounce(msg.channelId);
		this.ptyManager.destroy(msg.channelId);
	}

	private handleHeartbeat(msg: HeartbeatMessage): void {
		this.sendMessage({ type: "HEARTBEAT_ACK", ts: msg.ts });
	}

	/**
	 * Handle SNAPSHOT_REQ: produce a snapshot of the channel's headless
	 * terminal and reply with SNAPSHOT_RES.  Silently ignores unknown channels
	 * (the hub may ask for a snapshot of a channel that just exited).
	 */
	private handleSnapshotReq(msg: SnapshotReqMessage): void {
		const snapshot = this.ptyManager.snapshot(msg.channelId);
		if (snapshot === null) return; // channel gone — hub will reconcile
		this.sendMessage({
			type: "SNAPSHOT_RES",
			channelId: msg.channelId,
			snapshot,
			lastSeq: this.ptyManager.lastSeq(msg.channelId),
		});
	}

	/**
	 * Handle ATTACH: a client is reconnecting to an existing channel.
	 * Reply with ATTACH_OK + snapshot when the channel exists, or ERROR when
	 * the channel is gone (the hub must then SPAWN a new one).
	 */
	private handleAttach(msg: AgentAttachMessage): void {
		const snapshot = this.ptyManager.snapshot(msg.channelId);
		if (snapshot === null) {
			this.sendMessage({
				type: "ERROR",
				code: "CHANNEL_NOT_FOUND",
				message: `Channel not found: ${msg.channelId}`,
				channelId: msg.channelId,
			});
			return;
		}
		this.sendMessage({
			type: "ATTACH_OK",
			channelId: msg.channelId,
			snapshot,
			lastSeq: this.ptyManager.lastSeq(msg.channelId),
		});
	}
}
