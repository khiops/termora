import { EventEmitter } from "node:events";
import { FrameReader, type ProtocolMessage } from "@nexterm/shared";

/**
 * Abstract base class for communicating with a nexterm agent (local or remote SSH).
 *
 * Events:
 *   "ready"   — emitted once when the HELLO handshake completes
 *   "message" — emitted for every decoded ProtocolMessage
 *   "close"   — emitted when the transport closes (exit code or undefined)
 *   "error"   — emitted on transport / decode errors
 */
export abstract class AgentConnection extends EventEmitter {
	protected reader = new FrameReader();
	protected ready = false;

	/** Send a protocol message to the agent. */
	abstract send(msg: ProtocolMessage): void;

	/** Close the agent connection. */
	abstract close(): void;

	/** Whether the underlying transport is still active. */
	abstract get connected(): boolean;

	/** Feed raw bytes from the agent into the frame decoder. */
	protected handleData(data: Buffer): void {
		const messages = this.reader.push(data);
		for (const msg of messages) {
			if (msg.type === "HELLO" && !this.ready) {
				this.ready = true;
				this.emit("ready", msg);
			}
			this.emit("message", msg);
		}
	}
}
