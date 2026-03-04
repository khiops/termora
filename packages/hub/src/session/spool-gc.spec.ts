import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaDAL } from "../storage/meta.js";
import type { SpoolDAL } from "../storage/spool.js";
import { SpoolGarbageCollector } from "./spool-gc.js";

function makeSpoolDal(): SpoolDAL {
	return {
		deleteChunksOlderThan: vi.fn().mockReturnValue(0),
		incrementalVacuum: vi.fn(),
	} as unknown as SpoolDAL;
}

function makeMetaDal(): MetaDAL {
	return {} as unknown as MetaDAL;
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
});
