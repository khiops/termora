import { describe, expect, it } from "vitest";
import { OutputBuffer } from "./buffer.js";

describe("OutputBuffer", () => {
	describe("write", () => {
		it("stores data per channel", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2, 3]));
			buf.write("ch-2", new Uint8Array([4, 5]));

			expect(buf.channelSize("ch-1")).toBe(3);
			expect(buf.channelSize("ch-2")).toBe(2);
			expect(buf.totalBytes).toBe(5);
		});

		it("accumulates multiple writes", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2]));
			buf.write("ch-1", new Uint8Array([3, 4, 5]));

			expect(buf.channelSize("ch-1")).toBe(5);
			expect(buf.totalBytes).toBe(5);
		});
	});

	describe("per-channel cap", () => {
		it("drops oldest chunks when cap exceeded", () => {
			// Cap at 5 bytes per channel
			const buf = new OutputBuffer(5, 1024);
			buf.write("ch-1", new Uint8Array([1, 2, 3])); // 3 bytes
			buf.write("ch-1", new Uint8Array([4, 5, 6])); // 6 total -> over cap

			expect(buf.channelSize("ch-1")).toBeLessThanOrEqual(5);
		});

		it("preserves newest data", () => {
			// Cap at 4 bytes per channel
			const buf = new OutputBuffer(4, 1024);
			buf.write("ch-1", new Uint8Array([1, 2])); // 2 bytes
			buf.write("ch-1", new Uint8Array([3, 4])); // 4 total — at cap
			buf.write("ch-1", new Uint8Array([5, 6])); // 6 total -> drop oldest

			const drained = buf.drainAll();
			const data = drained.get("ch-1");
			expect(data).toBeDefined();

			// Oldest chunk [1,2] should be dropped; newer chunks preserved
			// After enforcing cap=4: [3,4] + [5,6] = 4 bytes — [1,2] dropped
			expect(data?.includes(5)).toBe(true);
			expect(data?.includes(6)).toBe(true);
		});
	});

	describe("global cap", () => {
		it("evicts from largest channel when global cap exceeded", () => {
			// Per-channel 100 bytes, global 8 bytes
			const buf = new OutputBuffer(100, 8);
			buf.write("ch-1", new Uint8Array([1, 2, 3, 4, 5])); // 5 bytes
			buf.write("ch-2", new Uint8Array([10, 20, 30])); // 3 bytes -> 8 total (at cap)
			buf.write("ch-2", new Uint8Array([40, 50])); // 5 bytes -> 10 total -> over cap

			// Global should have evicted from ch-1 (largest at time of overflow)
			expect(buf.totalBytes).toBeLessThanOrEqual(8);
		});
	});

	describe("drainAll", () => {
		it("returns all buffered data per channel", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2]));
			buf.write("ch-2", new Uint8Array([3, 4]));
			buf.write("ch-1", new Uint8Array([5]));

			const drained = buf.drainAll();
			expect(drained.size).toBe(2);

			const ch1 = drained.get("ch-1");
			expect(ch1).toBeDefined();
			expect(ch1).toEqual(Buffer.from([1, 2, 5]));

			const ch2 = drained.get("ch-2");
			expect(ch2).toBeDefined();
			expect(ch2).toEqual(Buffer.from([3, 4]));
		});

		it("clears internal buffers after drain", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2, 3]));

			buf.drainAll();

			expect(buf.totalBytes).toBe(0);
			expect(buf.channelSize("ch-1")).toBe(0);

			const second = buf.drainAll();
			expect(second.size).toBe(0);
		});

		it("returns empty map when no data buffered", () => {
			const buf = new OutputBuffer(1024, 4096);
			const drained = buf.drainAll();
			expect(drained.size).toBe(0);
		});
	});

	describe("remove", () => {
		it("removes specific channel buffer", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2, 3]));
			buf.write("ch-2", new Uint8Array([4, 5]));

			buf.remove("ch-1");

			expect(buf.channelSize("ch-1")).toBe(0);
			expect(buf.channelSize("ch-2")).toBe(2);

			const drained = buf.drainAll();
			expect(drained.has("ch-1")).toBe(false);
			expect(drained.has("ch-2")).toBe(true);
		});

		it("adjusts global byte count", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2, 3])); // 3 bytes
			buf.write("ch-2", new Uint8Array([4, 5])); // 2 bytes

			expect(buf.totalBytes).toBe(5);

			buf.remove("ch-1");
			expect(buf.totalBytes).toBe(2);
		});
	});

	describe("clear", () => {
		it("discards all data", () => {
			const buf = new OutputBuffer(1024, 4096);
			buf.write("ch-1", new Uint8Array([1, 2, 3]));
			buf.write("ch-2", new Uint8Array([4, 5]));

			buf.clear();

			expect(buf.totalBytes).toBe(0);
			expect(buf.channelSize("ch-1")).toBe(0);
			expect(buf.channelSize("ch-2")).toBe(0);

			const drained = buf.drainAll();
			expect(drained.size).toBe(0);
		});
	});
});
