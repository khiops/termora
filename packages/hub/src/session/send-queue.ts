import type { Writable } from "node:stream";

const MAX_QUEUE_SIZE = 1000;

/**
 * Reusable backpressure-aware send queue for writable streams.
 *
 * Attaches to a `Writable` (child process stdin, SSH channel, etc.) and
 * handles backpressure: when `write()` returns `false`, subsequent frames
 * are queued and flushed on the next `drain` event. The queue is capped at
 * {@link MAX_QUEUE_SIZE} — oldest frames are dropped when the cap is hit.
 */
export class SendQueue {
	private queue: Buffer[] = [];
	private draining = false;
	private stream: Writable | null = null;
	private readonly label: string;

	constructor(label: string) {
		this.label = label;
	}

	/** Attach to a writable stream. Wires the `drain` event. */
	attach(stream: Writable): void {
		if (this.stream) {
			this.stream.removeAllListeners("drain");
		}
		this.stream = stream;
		stream.on("drain", () => this.flush());
	}

	/**
	 * Send a frame. The frame is always written to the stream. If the write
	 * signals backpressure, subsequent frames are queued until the next
	 * `drain` event.
	 */
	send(frame: Buffer): void {
		if (!this.stream) return;

		if (this.draining) {
			this.enqueue(frame);
			return;
		}

		const ok = this.stream.write(frame);
		if (!ok) {
			this.draining = true;
		}
	}

	/** Clear the queue and detach from the stream. */
	clear(): void {
		this.queue.length = 0;
		this.draining = false;
		this.stream = null;
	}

	/** Number of frames waiting in the queue. */
	get pending(): number {
		return this.queue.length;
	}

	/** Whether the queue is currently in backpressure mode. */
	get isDraining(): boolean {
		return this.draining;
	}

	/** Read-only view of queued frames (useful for tests and diagnostics). */
	get frames(): readonly Buffer[] {
		return this.queue;
	}

	// ── Private ─────────────────────────────────────────────────────────

	private enqueue(frame: Buffer): void {
		if (this.queue.length >= MAX_QUEUE_SIZE) {
			if (this.queue.length === MAX_QUEUE_SIZE) {
				console.warn(
					`[${this.label}] send queue reached ${MAX_QUEUE_SIZE} messages, dropping oldest`,
				);
			}
			this.queue.shift();
		}
		this.queue.push(frame);
	}

	private flush(): void {
		this.draining = false;
		let frame = this.queue.shift();
		while (frame) {
			const ok = this.stream?.write(frame) ?? false;
			if (!ok) {
				this.draining = true;
				return;
			}
			frame = this.queue.shift();
		}
	}
}
