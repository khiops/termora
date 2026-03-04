import type { SpoolDAL } from "../storage/spool.js";

const CHUNK_MAX_BYTES = 256 * 1024; // 256 KB
const CHUNK_FLUSH_MS = 1_000; // 1 second

interface ChannelBuffer {
	chunks: Uint8Array[];
	totalBytes: number;
	timer: ReturnType<typeof setTimeout> | null;
	nextSeq: number;
}

export class OutputChunker {
	private channels = new Map<string, ChannelBuffer>();

	constructor(private spoolDal: SpoolDAL) {}

	/** Start tracking a channel for output chunking */
	trackChannel(channelId: string, startSeq?: number): void {
		if (this.channels.has(channelId)) return;
		this.channels.set(channelId, {
			chunks: [],
			totalBytes: 0,
			timer: null,
			nextSeq: startSeq ?? 1,
		});
	}

	/** Accumulate OUTPUT data for a channel */
	onOutput(channelId: string, data: Uint8Array): void {
		const buf = this.channels.get(channelId);
		if (!buf) return;

		buf.chunks.push(data);
		buf.totalBytes += data.byteLength;

		// Size-triggered flush
		if (buf.totalBytes >= CHUNK_MAX_BYTES) {
			this.flush(channelId);
			return;
		}

		// Start timer-triggered flush if not already running
		if (!buf.timer) {
			buf.timer = setTimeout(() => {
				buf.timer = null;
				this.flush(channelId);
			}, CHUNK_FLUSH_MS);
		}
	}

	/** Force-flush buffered data to spool.db */
	flush(channelId: string): void {
		const buf = this.channels.get(channelId);
		if (!buf || buf.totalBytes === 0) return;

		// Concatenate all chunks into a single blob
		const blob = this._concatChunks(buf.chunks, buf.totalBytes);

		// Write to spool.db
		this.spoolDal.insertChunk({
			channelId,
			seq: buf.nextSeq,
			kind: "output",
			dataBlob: blob,
			uncompressedLen: blob.byteLength,
		});

		// Reset buffer
		buf.nextSeq++;
		buf.chunks = [];
		buf.totalBytes = 0;
		if (buf.timer) {
			clearTimeout(buf.timer);
			buf.timer = null;
		}
	}

	/** Flush and stop tracking a channel */
	untrackChannel(channelId: string): void {
		this.flush(channelId);
		const buf = this.channels.get(channelId);
		if (buf?.timer) clearTimeout(buf.timer);
		this.channels.delete(channelId);
	}

	/** Flush all channels and stop */
	shutdown(): void {
		for (const channelId of this.channels.keys()) {
			this.untrackChannel(channelId);
		}
	}

	/** Get the current next seq for a channel (useful for SNAPSHOT_RES handling) */
	getNextSeq(channelId: string): number {
		return this.channels.get(channelId)?.nextSeq ?? 1;
	}

	private _concatChunks(chunks: Uint8Array[], totalBytes: number): Buffer {
		const result = Buffer.alloc(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return result;
	}
}
