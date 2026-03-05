import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaDAL } from "../storage/meta.js";
import type { SpoolDAL } from "../storage/spool.js";
import { SpoolGarbageCollector } from "./spool-gc.js";

function makeSpoolDal(): SpoolDAL {
	return {
		deleteChunksOlderThan: vi.fn().mockReturnValue(0),
		incrementalVacuum: vi.fn(),
		listChannelIds: vi.fn().mockReturnValue([]),
		getChannelSize: vi.fn().mockReturnValue(0),
		evictOldestChunks: vi.fn().mockReturnValue(0),
		deleteChunksForChannel: vi.fn().mockReturnValue(0),
	} as unknown as SpoolDAL;
}

function makeMetaDal(): MetaDAL {
	return {
		listStaleDeadChannelIds: vi.fn().mockReturnValue([]),
	} as unknown as MetaDAL;
}

describe("SpoolGarbageCollector", () => {
	let spoolDal: SpoolDAL;
	let metaDal: MetaDAL;
	let gc: SpoolGarbageCollector;

	beforeEach(() => {
		vi.useFakeTimers();
		spoolDal = makeSpoolDal();
		metaDal = makeMetaDal();
		gc = new SpoolGarbageCollector(spoolDal, metaDal);
	});

	afterEach(() => {
		gc.stop();
		vi.useRealTimers();
	});

	// ── Phase 1: age-based deletion ─────────────────────────────────────────

	it("collect() deletes old chunks with correct cutoff", () => {
		const before = Date.now();
		gc.collect();
		const after = Date.now();

		expect(spoolDal.deleteChunksOlderThan).toHaveBeenCalledTimes(1);
		const rawCutoff = vi.mocked(spoolDal.deleteChunksOlderThan).mock.calls[0]?.[0];
		expect(rawCutoff).toBeDefined();
		const cutoff = new Date(rawCutoff as string).getTime();

		const expectedMin = before - 168 * 3600 * 1000;
		const expectedMax = after - 168 * 3600 * 1000;
		expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
		expect(cutoff).toBeLessThanOrEqual(expectedMax);
	});

	it("collect() calls incrementalVacuum", () => {
		gc.collect();
		expect(spoolDal.incrementalVacuum).toHaveBeenCalledTimes(1);
	});

	it("start() triggers collect on the interval", () => {
		gc.start();
		expect(spoolDal.deleteChunksOlderThan).not.toHaveBeenCalled();

		vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
		expect(spoolDal.deleteChunksOlderThan).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(10 * 60 * 1000); // another 10 minutes
		expect(spoolDal.deleteChunksOlderThan).toHaveBeenCalledTimes(2);
	});

	it("stop() clears the interval", () => {
		gc.start();
		gc.stop();

		vi.advanceTimersByTime(10 * 60 * 1000);
		expect(spoolDal.deleteChunksOlderThan).not.toHaveBeenCalled();
	});

	it("start() is idempotent — second call does not double-schedule", () => {
		gc.start();
		gc.start();

		vi.advanceTimersByTime(10 * 60 * 1000);
		expect(spoolDal.deleteChunksOlderThan).toHaveBeenCalledTimes(1);
	});

	it("stop() when not started is a safe no-op", () => {
		expect(() => gc.stop()).not.toThrow();
	});

	// ── Phase 2: per-channel size cap ───────────────────────────────────────

	it("collect() triggers eviction for channels over 10 MB", () => {
		const overSize = 11 * 1024 * 1024;
		vi.mocked(spoolDal.listChannelIds).mockReturnValue(["ch-big", "ch-small"]);
		vi.mocked(spoolDal.getChannelSize).mockImplementation((id) =>
			id === "ch-big" ? overSize : 100,
		);

		gc.collect();

		expect(spoolDal.evictOldestChunks).toHaveBeenCalledTimes(1);
		expect(spoolDal.evictOldestChunks).toHaveBeenCalledWith("ch-big", 10 * 1024 * 1024);
	});

	it("collect() skips eviction for channels under 10 MB", () => {
		vi.mocked(spoolDal.listChannelIds).mockReturnValue(["ch-ok"]);
		vi.mocked(spoolDal.getChannelSize).mockReturnValue(5 * 1024 * 1024);

		gc.collect();

		expect(spoolDal.evictOldestChunks).not.toHaveBeenCalled();
	});

	// ── Phase 3: dead channel cleanup ───────────────────────────────────────

	it("collect() deletes spool data for channels dead > 24h", () => {
		vi.mocked(metaDal.listStaleDeadChannelIds).mockReturnValue(["ch-dead-1", "ch-dead-2"]);

		const before = Date.now();
		gc.collect();
		const after = Date.now();

		// Verify cutoff is ~24h ago
		const rawCutoff = vi.mocked(metaDal.listStaleDeadChannelIds).mock.calls[0]?.[0] as string;
		const cutoff = new Date(rawCutoff).getTime();
		const expectedMin = before - 24 * 60 * 60 * 1000;
		const expectedMax = after - 24 * 60 * 60 * 1000;
		expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
		expect(cutoff).toBeLessThanOrEqual(expectedMax);

		// Both dead channels cleaned up
		expect(spoolDal.deleteChunksForChannel).toHaveBeenCalledTimes(2);
		expect(spoolDal.deleteChunksForChannel).toHaveBeenCalledWith("ch-dead-1");
		expect(spoolDal.deleteChunksForChannel).toHaveBeenCalledWith("ch-dead-2");
	});

	it("collect() does not delete spool data when no stale dead channels", () => {
		vi.mocked(metaDal.listStaleDeadChannelIds).mockReturnValue([]);

		gc.collect();

		expect(spoolDal.deleteChunksForChannel).not.toHaveBeenCalled();
	});

	// ── Custom GcConfig ─────────────────────────────────────────────────────

	it("uses custom deadRetentionHours from GcConfig", () => {
		const customGc = new SpoolGarbageCollector(spoolDal, metaDal, {
			deadRetentionHours: 48,
			maxSizePerChannelMb: 10,
		});

		const before = Date.now();
		customGc.collect();
		const after = Date.now();

		const rawCutoff = vi.mocked(metaDal.listStaleDeadChannelIds).mock.calls[0]?.[0] as string;
		const cutoff = new Date(rawCutoff).getTime();
		const expectedMin = before - 48 * 60 * 60 * 1000;
		const expectedMax = after - 48 * 60 * 60 * 1000;
		expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
		expect(cutoff).toBeLessThanOrEqual(expectedMax);
	});

	it("uses custom maxSizePerChannelMb from GcConfig", () => {
		const customGc = new SpoolGarbageCollector(spoolDal, metaDal, {
			deadRetentionHours: 24,
			maxSizePerChannelMb: 50,
		});

		const overSize = 51 * 1024 * 1024;
		vi.mocked(spoolDal.listChannelIds).mockReturnValue(["ch-big"]);
		vi.mocked(spoolDal.getChannelSize).mockReturnValue(overSize);

		customGc.collect();

		expect(spoolDal.evictOldestChunks).toHaveBeenCalledWith("ch-big", 50 * 1024 * 1024);
	});

	it("deadRetentionHours = 0 uses current time as cutoff (immediate purge)", () => {
		const customGc = new SpoolGarbageCollector(spoolDal, metaDal, {
			deadRetentionHours: 0,
			maxSizePerChannelMb: 10,
		});

		const before = Date.now();
		customGc.collect();
		const after = Date.now();

		const rawCutoff = vi.mocked(metaDal.listStaleDeadChannelIds).mock.calls[0]?.[0] as string;
		const cutoff = new Date(rawCutoff).getTime();
		// With 0 retention, cutoff should be ~now
		expect(cutoff).toBeGreaterThanOrEqual(before);
		expect(cutoff).toBeLessThanOrEqual(after);
	});
});
