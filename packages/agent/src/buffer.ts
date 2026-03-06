/**
 * In-memory output buffer for PTY output during hub disconnects.
 *
 * Per-channel ring buffer with configurable per-channel and global caps.
 * Oldest bytes are dropped when caps are exceeded.
 * Buffers are in-memory only, never persisted to disk.
 */
export class OutputBuffer {
	private buffers = new Map<string, Buffer[]>();
	private channelBytes = new Map<string, number>();
	private globalBytes = 0;

	constructor(
		private readonly perChannelCap: number,
		private readonly globalCap: number,
	) {}

	/** Buffer output data for a channel. Drops oldest chunks if cap exceeded. */
	write(channelId: string, data: Uint8Array): void {
		const chunk = Buffer.from(data);

		if (!this.buffers.has(channelId)) {
			this.buffers.set(channelId, []);
			this.channelBytes.set(channelId, 0);
		}

		const channelBuf = this.buffers.get(channelId);
		if (!channelBuf) return;
		channelBuf.push(chunk);

		const currentChannelBytes = (this.channelBytes.get(channelId) ?? 0) + chunk.byteLength;
		this.channelBytes.set(channelId, currentChannelBytes);
		this.globalBytes += chunk.byteLength;

		// Per-channel cap: drop oldest chunks
		this.enforceChannelCap(channelId);

		// Global cap: evict from largest channel
		this.enforceGlobalCap();
	}

	/** Drain all buffered output. Returns a Map of channelId to concatenated Buffer. */
	drainAll(): Map<string, Buffer> {
		const result = new Map<string, Buffer>();
		for (const [channelId, chunks] of this.buffers) {
			if (chunks.length > 0) {
				result.set(channelId, Buffer.concat(chunks));
			}
		}
		this.buffers.clear();
		this.channelBytes.clear();
		this.globalBytes = 0;
		return result;
	}

	/** Remove buffered data for a specific channel (e.g., channel exited). */
	remove(channelId: string): void {
		const bytes = this.channelBytes.get(channelId) ?? 0;
		this.globalBytes -= bytes;
		this.buffers.delete(channelId);
		this.channelBytes.delete(channelId);
	}

	/** Current total bytes buffered across all channels. */
	get totalBytes(): number {
		return this.globalBytes;
	}

	/** Current bytes buffered for a specific channel. */
	channelSize(channelId: string): number {
		return this.channelBytes.get(channelId) ?? 0;
	}

	/** Discard all buffered data. */
	clear(): void {
		this.buffers.clear();
		this.channelBytes.clear();
		this.globalBytes = 0;
	}

	private enforceChannelCap(channelId: string): void {
		const chunks = this.buffers.get(channelId);
		if (!chunks) return;

		let size = this.channelBytes.get(channelId) ?? 0;
		while (size > this.perChannelCap && chunks.length > 0) {
			const dropped = chunks.shift();
			if (!dropped) break;
			size -= dropped.byteLength;
			this.globalBytes -= dropped.byteLength;
		}
		this.channelBytes.set(channelId, size);
	}

	private enforceGlobalCap(): void {
		while (this.globalBytes > this.globalCap && this.buffers.size > 0) {
			// Find channel with largest buffer
			let largestChannel = "";
			let largestSize = 0;
			for (const [id, size] of this.channelBytes) {
				if (size > largestSize) {
					largestSize = size;
					largestChannel = id;
				}
			}

			if (!largestChannel) break;

			const chunks = this.buffers.get(largestChannel);
			if (!chunks || chunks.length === 0) break;

			const dropped = chunks.shift();
			if (!dropped) break;
			const newSize = (this.channelBytes.get(largestChannel) ?? 0) - dropped.byteLength;
			this.channelBytes.set(largestChannel, newSize);
			this.globalBytes -= dropped.byteLength;

			if (newSize <= 0) {
				this.buffers.delete(largestChannel);
				this.channelBytes.delete(largestChannel);
			}
		}
	}
}
